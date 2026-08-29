// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AarkaSeries} from "./AarkaSeries.sol";
import {ExpiryCalendar} from "./ExpiryCalendar.sol";
import {AggregatorV3Interface, IOraclePausable, IScaledUIAmountNewUIMultiplier} from "./interfaces/IExternal.sol";

/// @title AarkaFactory
/// @notice Creates isolated series and holds the governed underlying-to-feed registry.
///
/// @dev Creation is permissionless in one dimension and governed in the other. Anyone may create
///      any (strike, expiry). Nobody may choose the price feed.
///
///      That split is the security decision in this contract. A silly strike hurts only the person
///      who uses it, and the series is isolated, so leaving that open costs nothing. A series
///      pointed at an attacker-controlled feed is a machine for stealing the deposit, so that one
///      degree of freedom is removed and every other one is left alone.
contract AarkaFactory is Ownable {
    // --------------------------------------------------------------------
    // Bounds
    // --------------------------------------------------------------------

    uint256 public constant MIN_TENOR = 1 days;
    uint256 public constant MAX_TENOR = 365 days;

    /// @notice $10bn per share at 8 decimals. Far beyond any real price; bounds the settlement
    ///         arithmetic explicitly rather than relying on mulDiv's 512-bit intermediate alone.
    uint256 public constant MAX_STRIKE = 1e18;

    /// @notice Fat-finger band on the strike, as a divisor and multiplier of spot.
    uint256 public constant STRIKE_BAND = 5;

    /// @notice How stale the spot price may be for the band check only.
    /// @dev Generous by design. This is a usability guard, not a safety property, and a series
    ///      should still be creatable over a weekend using Friday's close.
    uint256 public constant BAND_MAX_STALENESS = 4 days;

    // --------------------------------------------------------------------
    // State
    // --------------------------------------------------------------------

    ExpiryCalendar public immutable calendar;

    /// @notice The sequencer uptime feed, applied to every new series.
    /// @dev Zero until Chainlink publishes one for Robinhood Chain. See ARCHITECTURE.md A.3.
    AggregatorV3Interface public sequencerUptime;

    mapping(address underlying => AggregatorV3Interface) public feedFor;
    mapping(address => bool) public isSeries;
    address[] public allSeries;

    bool public creationPaused;

    // --------------------------------------------------------------------
    // Events
    // --------------------------------------------------------------------

    event AssetRegistered(address indexed underlying, address indexed feed, address indexed previousFeed);
    event SequencerFeedSet(address indexed feed);
    event CreationPausedSet(bool paused);
    event SeriesCreated(
        address indexed series,
        address indexed underlying,
        uint256 strike,
        uint64 indexed expiry,
        address floorToken,
        address upsideToken
    );

    // --------------------------------------------------------------------
    // Errors
    // --------------------------------------------------------------------

    error CreationPaused();
    error AssetNotRegistered();
    error UnexpectedFeedDecimals();
    error InvalidExpiry();
    error TenorTooShort();
    error TenorTooLong();
    error InvalidStrike();
    error StrikeOutOfBand();
    error SpotUnavailable();
    error OraclePaused();
    error CorporateActionScheduled();
    error SeriesExists();

    constructor(address owner_, ExpiryCalendar calendar_, AggregatorV3Interface sequencerUptime_)
        Ownable(owner_)
    {
        calendar = calendar_;
        sequencerUptime = sequencerUptime_;
        emit SequencerFeedSet(address(sequencerUptime_));
    }

    // --------------------------------------------------------------------
    // Governance
    // --------------------------------------------------------------------

    /// @notice Point an underlying at its Chainlink feed.
    /// @dev Affects only series created afterwards. Every existing series stores its feed as an
    ///      immutable, so no change here can reach one. Repointing does change the CREATE2 address
    ///      for future series of that asset, because the feed is a constructor argument.
    function registerAsset(address underlying, AggregatorV3Interface feed) external onlyOwner {
        if (feed.decimals() != 8) revert UnexpectedFeedDecimals();
        address previous = address(feedFor[underlying]);
        feedFor[underlying] = feed;
        emit AssetRegistered(underlying, address(feed), previous);
    }

    function setSequencerFeed(AggregatorV3Interface feed) external onlyOwner {
        sequencerUptime = feed;
        emit SequencerFeedSet(address(feed));
    }

    function setCreationPaused(bool paused) external onlyOwner {
        creationPaused = paused;
        emit CreationPausedSet(paused);
    }

    // --------------------------------------------------------------------
    // Creation
    // --------------------------------------------------------------------

    function createSeries(address underlying, uint256 strike, uint64 expiry)
        external
        returns (address series)
    {
        if (creationPaused) revert CreationPaused();

        AggregatorV3Interface feed = feedFor[underlying];
        if (address(feed) == address(0)) revert AssetNotRegistered();
        if (feed.decimals() != 8) revert UnexpectedFeedDecimals();

        if (strike == 0 || strike > MAX_STRIKE) revert InvalidStrike();
        if (!calendar.isValidExpiry(expiry)) revert InvalidExpiry();
        if (expiry < block.timestamp + MIN_TENOR) revert TenorTooShort();
        if (expiry > block.timestamp + MAX_TENOR) revert TenorTooLong();

        _requireNoCorporateAction(underlying, expiry);
        _requireStrikeInBand(feed, strike);

        bytes32 salt = keccak256(abi.encode(underlying, strike, expiry));
        if (seriesFor(underlying, strike, expiry).code.length != 0) revert SeriesExists();

        series = address(
            new AarkaSeries{salt: salt}(IERC20(underlying), feed, sequencerUptime, strike, expiry)
        );

        isSeries[series] = true;
        allSeries.push(series);

        emit SeriesCreated(
            series,
            underlying,
            strike,
            expiry,
            address(AarkaSeries(series).floorToken()),
            address(AarkaSeries(series).upsideToken())
        );
    }

    // --------------------------------------------------------------------
    // Views
    // --------------------------------------------------------------------

    /// @notice The deterministic address of a series, whether or not it has been deployed.
    /// @dev Lets any integrator resolve a series off-chain with no subgraph and no event scan.
    function seriesFor(address underlying, uint256 strike, uint64 expiry) public view returns (address) {
        bytes32 salt = keccak256(abi.encode(underlying, strike, expiry));
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(AarkaSeries).creationCode,
                abi.encode(underlying, feedFor[underlying], sequencerUptime, strike, expiry)
            )
        );
        return Create2.computeAddress(salt, initCodeHash, address(this));
    }

    function seriesCount() external view returns (uint256) {
        return allSeries.length;
    }

    // --------------------------------------------------------------------
    // Internal guards
    // --------------------------------------------------------------------

    /// @dev ERC-8056 announces a corporate action with a future effective timestamp, which is what
    ///      lets a series refuse to be written across one. Both interfaces are probed rather than
    ///      required, so a token that omits them is simply not gated on them.
    function _requireNoCorporateAction(address underlying, uint64 expiry) private view {
        (bool okPause, bytes memory pauseData) =
            underlying.staticcall(abi.encodeCall(IOraclePausable.oraclePaused, ()));
        if (okPause && pauseData.length == 32 && abi.decode(pauseData, (bool))) revert OraclePaused();

        (bool okAt, bytes memory atData) =
            underlying.staticcall(abi.encodeCall(IScaledUIAmountNewUIMultiplier.effectiveAt, ()));
        if (okAt && atData.length == 32) {
            uint256 effectiveAt = abi.decode(atData, (uint256));
            if (effectiveAt != 0 && effectiveAt <= expiry) revert CorporateActionScheduled();
        }
    }

    /// @dev Usability guard, not a safety property. Nothing about the payoff breaks at a silly
    ///      strike; this only stops an obvious mistake reaching a deployed series.
    function _requireStrikeInBand(AggregatorV3Interface feed, uint256 strike) private view {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0 || updatedAt == 0) revert SpotUnavailable();
        if (block.timestamp - updatedAt > BAND_MAX_STALENESS) revert SpotUnavailable();

        uint256 spot = uint256(answer);
        if (strike < spot / STRIKE_BAND || strike > spot * STRIKE_BAND) revert StrikeOutOfBand();
    }
}
