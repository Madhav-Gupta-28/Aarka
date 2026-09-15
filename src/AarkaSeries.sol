// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {AarkaToken} from "./AarkaToken.sol";
import {DateLib} from "./libraries/DateLib.sol";
import {AggregatorV3Interface, IOraclePausable, IScaledUIAmountNewUIMultiplier} from "./interfaces/IExternal.sol";

/// @title AarkaSeries
/// @notice An isolated vault for one (underlying, strike, expiry). Splits a tokenized stock into
///         a floor half and an upside half, and settles them against a Chainlink price at expiry.
///
/// @dev Payouts, in units of the underlying:
///
///          floor  = min(S, K) / S      keeps the downside, capped at the strike
///          upside = max(0, S - K) / S  zero at or below the strike, uncapped above
///
///      These sum to exactly 1 at every price, which is why `redeem` never has to be disabled
///      and why the vault cannot become insolvent. See ARCHITECTURE.md sections 2 and 6.
///
///      There is no owner, no pause, no upgrade path, and no privileged withdrawal. The absence
///      of an emergency exit is deliberate: `redeem` is permanently open, so none is needed.
contract AarkaSeries is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // --------------------------------------------------------------------
    // Constants
    // --------------------------------------------------------------------

    /// @notice Base for payout ratios.
    uint256 public constant ONE = 1e18;

    /// @notice Chainlink Robinhood equity feeds all report 8 decimals. Asserted, never assumed.
    uint8 public constant FEED_DECIMALS = 8;

    /// @notice How far before expiry the settlement round may have been published.
    /// @dev 26 hours: the feeds' 24-hour heartbeat plus two hours of margin.
    ///
    ///      Robinhood Chain's equity feeds publish on a 0.5% move or once a day. A calm session
    ///      therefore produces no rounds at all, and until the next one is published the last price
    ///      is still within 0.5% of the market — that is what the deviation threshold guarantees.
    ///      So an old round on a quiet day is accurate, not stale.
    ///
    ///      This used to be 6 hours, chosen to keep the round inside the closing session and to
    ///      detect a corporate-action pause by the silence it causes. On a quiet ticker it stranded
    ///      people instead: SPY's last round before the 11 Sep 2026 close was 7.1 hours old, so a
    ///      SPY series expiring that day could never have settled, and anyone holding one half
    ///      could never have claimed. The pause is now checked explicitly. See AUDIT-16.
    uint256 public constant MAX_SETTLEMENT_AGE = 26 hours;

    /// @notice After this long unsettled, settlement accepts the last round before expiry at any
    ///         age, and stops requiring the sequencer to be up or the asset to be unpaused.
    /// @dev The last resort, and the reason a series always resolves. If the feed was deprecated,
    ///      the asset paused for weeks or the sequencer feed misconfigured, the normal path refuses
    ///      forever — and a holder of one half cannot recombine their way out. A week of refusal
    ///      is enough for any of those to be a real failure rather than a pause. A late price is a
    ///      worse price; no price is worse still. The challenge window still applies, so a
    ///      strictly later round at or before expiry replaces it.
    uint256 public constant LATE_SETTLEMENT_DELAY = 7 days;

    /// @notice Window in which a settlement may be replaced by a strictly better round.
    uint256 public constant CHALLENGE_PERIOD = 1 hours;

    /// @notice Time the sequencer must have been up before a price is trusted.
    uint256 public constant SEQUENCER_GRACE_PERIOD = 1 hours;

    // --------------------------------------------------------------------
    // Immutable terms
    // --------------------------------------------------------------------

    IERC20 public immutable underlying;
    AggregatorV3Interface public immutable feed;
    AggregatorV3Interface public immutable sequencerUptime;
    uint256 public immutable strike; // 8 decimals, same base as the feed
    uint64 public immutable expiry;
    AarkaToken public immutable floorToken;
    AarkaToken public immutable upsideToken;
    bool public immutable hasOraclePause;

    // --------------------------------------------------------------------
    // Settlement state
    // --------------------------------------------------------------------

    bool public settled;
    uint80 public settlementRoundId;
    uint256 public settlementPrice; // 8 decimals
    uint256 public settlementUpdatedAt;
    uint256 public floorPayoutPerUnit; // 18 decimals
    uint256 public upsidePayoutPerUnit; // 18 decimals
    uint64 public claimsUnlockAt;
    /// @notice True when the series was settled through the late path.
    bool public settledLate;

    // --------------------------------------------------------------------
    // Events
    // --------------------------------------------------------------------

    event Minted(address indexed by, address indexed to, uint256 amount);
    event Redeemed(address indexed by, address indexed to, uint256 amount);
    event Settled(uint80 indexed roundId, uint256 price, uint256 updatedAt, uint256 floorPayout);
    event Challenged(uint80 indexed roundId, uint256 price, uint256 updatedAt, uint256 floorPayout);
    event Claimed(address indexed by, address indexed to, bool isFloor, uint256 burned, uint256 paid);
    event SequencerCheckDisabled();

    // --------------------------------------------------------------------
    // Errors
    // --------------------------------------------------------------------

    error ZeroAmount();
    error ZeroAddress();
    error Expired();
    error NotExpired();
    error AlreadySettled();
    error NotSettled();
    error InvalidPrice();
    error IncompleteRound();
    error RoundAfterExpiry();
    error RoundTooOld();
    error LaterRoundExists();
    error NotAnImprovement();
    error ChallengeWindowClosed();
    error ClaimsLocked();
    error UnexpectedFeedDecimals();
    error OraclePaused();
    error SequencerDown();
    error SequencerGracePeriod();
    error RoundIdOverflow();
    error CorporateActionBeforeExpiry();

    // --------------------------------------------------------------------
    // Construction
    // --------------------------------------------------------------------

    constructor(
        IERC20 underlying_,
        AggregatorV3Interface feed_,
        AggregatorV3Interface sequencerUptime_,
        uint256 strike_,
        uint64 expiry_
    ) {
        underlying = underlying_;
        feed = feed_;
        sequencerUptime = sequencerUptime_;
        strike = strike_;
        expiry = expiry_;

        // Probe for the Robinhood oracle-pause signal. It is not part of ERC-8056, so a token
        // without it is recorded as absent rather than treated as an error.
        (bool ok, bytes memory data) =
            address(underlying_).staticcall(abi.encodeCall(IOraclePausable.oraclePaused, ()));
        hasOraclePause = ok && data.length == 32;

        if (address(sequencerUptime_) == address(0)) emit SequencerCheckDisabled();

        // Symbols are derived on-chain. Creation is permissionless in (strike, expiry), so a
        // creator-supplied symbol would be a way to mislabel a series.
        string memory ticker = IERC20Metadata(address(underlying_)).symbol();
        string memory tag = DateLib.toTag(expiry_);
        string memory usd = _usd(strike_);

        // The strike goes in the symbol as well as the name. Wallets and token lists show the
        // symbol, and two series on the same expiry used to share one: fNVDA-30OCT26 was both the
        // $210 and the $230 floor. The strike is the one term a buyer must not get wrong. AUDIT-17.
        string memory strikeTag = _strikeTag(strike_);
        floorToken = new AarkaToken(
            string.concat("Aarka Floor ", ticker, " ", tag, " $", usd),
            string.concat("f", ticker, "-", strikeTag, "-", tag)
        );
        upsideToken = new AarkaToken(
            string.concat("Aarka Upside ", ticker, " ", tag, " $", usd),
            string.concat("u", ticker, "-", strikeTag, "-", tag)
        );
    }

    // --------------------------------------------------------------------
    // Mint and redeem
    // --------------------------------------------------------------------

    /// @notice Deposit `amount` of the underlying, receive that many of each half.
    /// @dev Closed at expiry. There is no economic reason to split an expired series, and keeping
    ///      the window shut makes the supply invariant easier to reason about.
    function mint(uint256 amount, address to) external nonReentrant {
        if (block.timestamp >= expiry) revert Expired();
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        // Mint against the observed delta, not the requested amount, so the supply invariant
        // holds by construction even against a token that takes a fee on transfer.
        uint256 balanceBefore = underlying.balanceOf(address(this));
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = underlying.balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();

        floorToken.mint(to, received);
        upsideToken.mint(to, received);
        emit Minted(msg.sender, to, received);
    }

    /// @notice Return one of each half, receive one underlying.
    /// @dev Never disabled. Before expiry, after expiry, after settlement, or with a permanently
    ///      dead oracle, a holder of both halves can always get their stock token back. A holder of
    ///      one half depends on settlement instead, which is why settlement has a late path and
    ///      always resolves eventually.
    ///
    ///      Safe after settlement because floorPayoutPerUnit + upsidePayoutPerUnit == ONE exactly,
    ///      so a pair is worth precisely one underlying and never more.
    function redeem(uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        floorToken.burn(msg.sender, amount);
        upsideToken.burn(msg.sender, amount);
        underlying.safeTransfer(to, amount);
        emit Redeemed(msg.sender, to, amount);
    }

    // --------------------------------------------------------------------
    // Settlement
    // --------------------------------------------------------------------

    /// @notice Settle the series against the last feed round at or before expiry.
    /// @dev Takes a roundId rather than reading the latest price. The caller supplies a candidate
    ///      and the contract proves it is the right one, so the caller chooses when to transact
    ///      but has no influence over what price results.
    ///
    ///      Two paths, and every series reaches one of them:
    ///
    ///        normal  the round is at most MAX_SETTLEMENT_AGE before expiry, the sequencer is up,
    ///                the asset is not paused, and no corporate action landed after the round
    ///        late    LATE_SETTLEMENT_DELAY after expiry, only the round pinning and the feed's
    ///                decimals are still required
    function settle(uint80 roundId) external nonReentrant {
        if (block.timestamp < expiry) revert NotExpired();
        if (settled) revert AlreadySettled();
        if (feed.decimals() != FEED_DECIMALS) revert UnexpectedFeedDecimals();

        bool late = block.timestamp >= expiry + LATE_SETTLEMENT_DELAY;
        if (!late) {
            _requireSequencerUp();
            if (hasOraclePause && IOraclePausable(address(underlying)).oraclePaused()) revert OraclePaused();
        }

        (uint256 price, uint256 updatedAt) = _readRound(roundId);
        if (updatedAt > expiry) revert RoundAfterExpiry();
        if (!late) {
            if (expiry - updatedAt > MAX_SETTLEMENT_AGE) revert RoundTooOld();
            _requireNoCorporateActionSince(updatedAt);
        }
        _requireNoLaterRound(roundId);

        settled = true;
        settledLate = late;
        claimsUnlockAt = uint64(block.timestamp + CHALLENGE_PERIOD);
        _record(roundId, price, updatedAt);
        emit Settled(roundId, price, updatedAt, floorPayoutPerUnit);
    }

    /// @notice Replace the settlement with a strictly later round that is still at or before expiry.
    /// @dev Covers the one hole in `settle`: at a Chainlink phase boundary, roundId + 1 is a
    ///      well-formed identifier that does not exist, so the successor check can pass vacuously.
    ///
    ///      Converges, because every accepted challenge strictly increases settlementUpdatedAt and
    ///      only finitely many rounds precede expiry. Monotone, because settlement can only move
    ///      towards expiry. Bounded, because claimsUnlockAt is never extended.
    function challengeSettlement(uint80 betterRoundId) external nonReentrant {
        if (!settled) revert NotSettled();
        if (block.timestamp >= claimsUnlockAt) revert ChallengeWindowClosed();

        (uint256 price, uint256 updatedAt) = _readRound(betterRoundId);
        if (updatedAt > expiry) revert RoundAfterExpiry();
        if (updatedAt <= settlementUpdatedAt) revert NotAnImprovement();

        // No lookback re-check needed: a round later than one that already passed it is
        // necessarily closer to expiry.
        _record(betterRoundId, price, updatedAt);
        emit Challenged(betterRoundId, price, updatedAt, floorPayoutPerUnit);
    }

    // --------------------------------------------------------------------
    // Claims
    // --------------------------------------------------------------------

    function claimFloor(uint256 amount, address to) external nonReentrant returns (uint256 paid) {
        paid = _claim(floorToken, floorPayoutPerUnit, amount, to, true);
    }

    function claimUpside(uint256 amount, address to) external nonReentrant returns (uint256 paid) {
        paid = _claim(upsideToken, upsidePayoutPerUnit, amount, to, false);
    }

    function _claim(AarkaToken token, uint256 payoutPerUnit, uint256 amount, address to, bool isFloor)
        private
        returns (uint256 paid)
    {
        if (!settled) revert NotSettled();
        if (block.timestamp < claimsUnlockAt) revert ClaimsLocked();
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        token.burn(msg.sender, amount);

        // Always rounds down. The remainder stays in the vault, which is what keeps the sum of
        // all claims at or below the balance.
        paid = Math.mulDiv(amount, payoutPerUnit, ONE);

        // A payout of zero is legal and must not revert. An upside token that finished out of
        // the money is genuinely worth nothing, and holders still need to burn it.
        if (paid != 0) underlying.safeTransfer(to, paid);
        emit Claimed(msg.sender, to, isFloor, amount, paid);
    }

    // --------------------------------------------------------------------
    // Oracle reads
    // --------------------------------------------------------------------

    function _record(uint80 roundId, uint256 price, uint256 updatedAt) private {
        settlementRoundId = roundId;
        settlementPrice = price;
        settlementUpdatedAt = updatedAt;

        // floor = min(S, K) / S, floored. Bounded above by ONE:
        //   S <= K  ->  mulDiv(S, ONE, S) == ONE exactly
        //   S >  K  ->  mulDiv(K, ONE, S) <  ONE
        uint256 fp = Math.mulDiv(Math.min(price, strike), ONE, price);

        // The upside leg is the exact complement, never computed independently. This makes
        // fp + up == ONE an identity the compiler enforces rather than a property tests hope for.
        floorPayoutPerUnit = fp;
        upsidePayoutPerUnit = ONE - fp;
    }

    function _readRound(uint80 roundId) private view returns (uint256 price, uint256 updatedAt) {
        (, int256 answer,, uint256 at,) = feed.getRoundData(roundId);
        if (answer <= 0) revert InvalidPrice();
        if (at == 0) revert IncompleteRound();
        return (uint256(answer), at);
    }

    /// @dev The try/catch is load-bearing, not padding. A Chainlink proxy roundId is the composite
    ///      (phaseId << 64) | aggregatorRoundId. At a phase boundary roundId + 1 is well-formed but
    ///      does not exist, and getRoundData reverts. Without the catch, every series expiring near
    ///      an aggregator migration would be permanently unsettleable.
    function _requireNoLaterRound(uint80 roundId) private view {
        if (roundId == type(uint80).max) revert RoundIdOverflow();
        try feed.getRoundData(roundId + 1) returns (uint80, int256, uint256, uint256 nextAt, uint80) {
            if (nextAt != 0 && nextAt <= expiry) revert LaterRoundExists();
        } catch {
            // No successor round. roundId was the latest.
        }
    }

    /// @dev A corporate action that took effect after the settlement round and at or before expiry
    ///      means the round may describe the token as it was before the action. This replaces what
    ///      the old six-hour bound did implicitly — a pause during an action silenced the feed and
    ///      settlement blocked itself — with a check that says what it is checking. Probed, not
    ///      required: a token without ERC-8056 is not gated on it.
    function _requireNoCorporateActionSince(uint256 updatedAt) private view {
        (bool ok, bytes memory data) =
            address(underlying).staticcall(abi.encodeCall(IScaledUIAmountNewUIMultiplier.effectiveAt, ()));
        if (!ok || data.length != 32) return;
        uint256 effectiveAt = abi.decode(data, (uint256));
        if (effectiveAt > updatedAt && effectiveAt <= expiry) revert CorporateActionBeforeExpiry();
    }

    /// @dev Robinhood Chain is an Arbitrum Orbit L2. A stalled sequencer freezes feed updates while
    ///      every read keeps succeeding. The grace period exists because the instant a sequencer
    ///      restarts, users who could not transact during the outage have had no chance to react
    ///      while the feed has already caught up.
    function _requireSequencerUp() private view {
        if (address(sequencerUptime) == address(0)) return; // see ARCHITECTURE.md appendix A.3
        (, int256 up, uint256 startedAt,,) = sequencerUptime.latestRoundData();
        if (up != 0) revert SequencerDown();

        // A feed that has never reported returns startedAt == 0, and `block.timestamp - 0` is
        // enormous, so the grace check below would wave it straight through. An uninitialised or
        // future-dated feed is not evidence the sequencer is healthy; treat it as evidence of
        // nothing and refuse. Refusing costs only the payoff split -- redeem stays open either way.
        if (startedAt == 0 || startedAt > block.timestamp) revert SequencerDown();
        if (block.timestamp - startedAt <= SEQUENCER_GRACE_PERIOD) revert SequencerGracePeriod();
    }

    // --------------------------------------------------------------------
    // Views
    // --------------------------------------------------------------------

    /// @notice What one unit of each half pays, in units of the underlying.
    function payouts() external view returns (uint256 floorPayout, uint256 upsidePayout) {
        return (floorPayoutPerUnit, upsidePayoutPerUnit);
    }

    /// @dev "210" for $210.00, "212.50" for $212.50. The factory only accepts whole-cent strikes, so
    ///      two different strikes can never render the same.
    function _strikeTag(uint256 strike8) private pure returns (string memory) {
        uint256 cents = (strike8 % 1e8) / 1e6;
        if (cents == 0) return Strings.toString(strike8 / 1e8);
        return string.concat(Strings.toString(strike8 / 1e8), ".", cents < 10 ? "0" : "", Strings.toString(cents));
    }

    function _usd(uint256 strike8) private pure returns (string memory) {
        uint256 cents = (strike8 % 1e8) / 1e6;
        return string.concat(
            Strings.toString(strike8 / 1e8), ".", cents < 10 ? "0" : "", Strings.toString(cents)
        );
    }
}
