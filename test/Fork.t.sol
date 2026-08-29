// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {ExpiryCalendar} from "../src/ExpiryCalendar.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {DateLib} from "../src/libraries/DateLib.sol";

/// @notice Runs against Robinhood Chain mainnet with the real stock tokens and the real Chainlink
///         feeds. This is the test a mock cannot replace: real feed decimals, real round cadence,
///         real composite roundIds, real corporate-action state.
///
///         forge test --match-path test/Fork.t.sol --fork-url robinhood
contract ForkTest is Test {
    // Verified on-chain 2026-08-29: symbol() and decimals() checked on every one.
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address constant AAPL_FEED = 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0;

    address constant V4_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    uint256 constant PHASE_1 = 1 << 64;

    AggregatorV3Interface feed = AggregatorV3Interface(NVDA_FEED);
    IERC20 nvda = IERC20(NVDA);
    address alice = makeAddr("alice");
    address owner = makeAddr("owner");

    function setUp() public {
        vm.skip(block.chainid != 4663);
    }

    // ---------------------------------------------------------------- the chain

    function test_chainFactsMatchTheArchitectureDoc() public view {
        assertEq(block.chainid, 4663);
        assertEq(IERC20Metadata(USDG).decimals(), 6, "USDG is 6 decimals");
        assertEq(IERC20Metadata(NVDA).decimals(), 18, "stock tokens are 18 decimals");
        assertEq(IERC20Metadata(NVDA).symbol(), "NVDA");
        assertEq(IERC20Metadata(NVDA).name(), unicode"NVIDIA \u2022 Robinhood Token");
        assertGt(V4_POOL_MANAGER.code.length, 0, "Uniswap v4 PoolManager is deployed");
    }

    function test_feedMatchesTheDocumentedShape() public view {
        assertEq(feed.decimals(), 8, "equity feeds are 8 decimals");
        assertEq(feed.description(), "RHNVDA / USD");

        (uint80 roundId, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertGt(answer, 0);
        assertGt(uint256(roundId), PHASE_1, "roundIds are (phaseId << 64) | aggregatorRound");

        console.log("aggregator round:", uint256(roundId) - PHASE_1);
        console.log("NVDA price (8dp):", uint256(answer));
        console.log("feed staleness (s):", block.timestamp - updatedAt);
    }

    // ---------------------------------------------------------------- full lifecycle

    /// @notice Deposit real NVDA, split it, settle against a real Chainlink round, claim both legs.
    /// @dev The series is deployed directly rather than through the factory, because the factory
    ///      correctly refuses an expiry in the past and every settleable round is in the past.
    function test_fullLifecycleWithRealTokenAndRealFeed() public {
        (uint80 latest,,,,) = feed.latestRoundData();
        uint80 target = latest - 30;

        (, int256 answer,, uint256 updatedAt,) = feed.getRoundData(target);
        (,,, uint256 nextUpdatedAt,) = feed.getRoundData(target + 1);
        uint64 expiry = uint64(updatedAt + (nextUpdatedAt - updatedAt) / 2);
        assertLe(expiry - updatedAt, 6 hours, "gap must fit inside MAX_SETTLEMENT_LOOKBACK");

        uint256 settlementPrice = uint256(answer);
        uint256 strike = settlementPrice / 2; // deep in the money, so both legs pay out

        AarkaSeries series = new AarkaSeries(
            nvda, feed, AggregatorV3Interface(address(0)), strike, expiry
        );

        // Real token naming, derived on-chain from the real symbol.
        assertEq(series.floorToken().symbol(), string.concat("fNVDA-", _tag(expiry)));

        // The settleable round is in the past relative to the fork block, so wind the clock back
        // to inside the series' life in order to mint.
        vm.warp(updatedAt - 1 hours);

        deal(NVDA, alice, 100e18);
        vm.startPrank(alice);
        nvda.approve(address(series), type(uint256).max);
        series.mint(100e18, alice);
        vm.stopPrank();

        assertEq(series.floorToken().balanceOf(alice), 100e18);
        assertEq(series.upsideToken().balanceOf(alice), 100e18);
        assertEq(nvda.balanceOf(address(series)), 100e18);

        vm.warp(expiry + 1);
        series.settle(target);
        assertEq(series.settlementPrice(), settlementPrice);
        assertEq(series.floorPayoutPerUnit() + series.upsidePayoutPerUnit(), 1e18);

        vm.warp(expiry + 1 + series.CHALLENGE_PERIOD());
        vm.startPrank(alice);
        uint256 paidFloor = series.claimFloor(100e18, alice);
        uint256 paidUpside = series.claimUpside(100e18, alice);
        vm.stopPrank();

        // Strike is half of spot, so the floor keeps half and the upside keeps half.
        assertApproxEqRel(paidFloor, 50e18, 1e15);
        assertApproxEqRel(paidUpside, 50e18, 1e15);
        assertEq(paidFloor + paidUpside, 100e18, "conservation, to the wei");
        assertEq(nvda.balanceOf(address(series)), 0, "vault fully drained, nothing stranded");
    }

    /// @notice Redeem must work on the real token with no settlement at all.
    function test_redeemNeedsNoOracleOnTheRealToken() public {
        AarkaSeries series = new AarkaSeries(
            nvda, feed, AggregatorV3Interface(address(0)), 230e8, uint64(block.timestamp + 7 days)
        );
        deal(NVDA, alice, 10e18);
        vm.startPrank(alice);
        nvda.approve(address(series), type(uint256).max);
        series.mint(10e18, alice);
        vm.warp(block.timestamp + 400 days); // long past expiry, never settled
        series.redeem(10e18, alice);
        vm.stopPrank();

        assertEq(nvda.balanceOf(alice), 10e18);
        assertFalse(series.settled());
    }

    // ---------------------------------------------------------------- factory against real state

    /// @notice The whole creation path against real contracts.
    function test_factoryCreatesASeriesOnTheRealNvda() public {
        (AarkaFactory factory, ExpiryCalendar calendar) = _deployFactory();
        uint64 expiry = _nextValidExpiry(calendar);

        vm.prank(owner);
        factory.registerAsset(NVDA, feed);

        (, int256 spot,,,) = feed.latestRoundData();
        address series = factory.createSeries(NVDA, uint256(spot), expiry);
        assertEq(series, factory.seriesFor(NVDA, uint256(spot), expiry));
        assertEq(address(AarkaSeries(series).underlying()), NVDA);
    }

    /// @notice Regression against live state. AAPL carries a non-zero effectiveAt from a dividend
    ///         that has already been applied (uiMultiplier is 1.000566, not 1.0). Gating on
    ///         `effectiveAt != 0` rather than `effectiveAt > block.timestamp` made every AAPL
    ///         series impossible to create. This is the bug real data caught that mocks did not.
    function test_appleWithAnAppliedDividendCanStillHaveASeries() public {
        assertGt(IScaledUI(AAPL).uiMultiplier(), 1e18, "AAPL has already paid a dividend");
        assertGt(IScaledUI(AAPL).effectiveAt(), 0, "and effectiveAt was never cleared");
        assertLt(IScaledUI(AAPL).effectiveAt(), block.timestamp, "it is in the past");

        (AarkaFactory factory, ExpiryCalendar calendar) = _deployFactory();
        uint64 expiry = _nextValidExpiry(calendar);

        vm.prank(owner);
        factory.registerAsset(AAPL, AggregatorV3Interface(AAPL_FEED));

        (, int256 spot,,,) = AggregatorV3Interface(AAPL_FEED).latestRoundData();
        factory.createSeries(AAPL, uint256(spot), expiry); // must not revert
    }

    // ---------------------------------------------------------------- helpers

    function _deployFactory() internal returns (AarkaFactory, ExpiryCalendar) {
        ExpiryCalendar calendar = new ExpiryCalendar(owner);
        AarkaFactory factory = new AarkaFactory(owner, calendar, AggregatorV3Interface(address(0)));
        return (factory, calendar);
    }

    function _nextValidExpiry(ExpiryCalendar calendar) internal returns (uint64 expiry) {
        expiry = uint64(block.timestamp + 14 days);
        uint64[] memory dates = new uint64[](1);
        dates[0] = expiry;
        vm.prank(owner);
        calendar.addExpiries(dates);
    }

    function _tag(uint64 ts) internal pure returns (string memory) {
        return DateLib.toTag(ts);
    }
}

interface IERC20Metadata {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
    function name() external view returns (string memory);
}

interface IScaledUI {
    function uiMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
}

