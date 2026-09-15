// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {DeployTestnet} from "../script/DeployTestnet.s.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {ExpiryCalendar} from "../src/ExpiryCalendar.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {TestStockToken} from "../src/testnet/TestStockToken.sol";
import {TestAggregator} from "../src/testnet/TestAggregator.sol";
import {NyseCalendar2026} from "../src/testnet/NyseCalendar2026.sol";

/// @notice Runs the testnet deployment end to end before it touches a real chain, then drives a
///         full lifecycle through the deployed contracts.
contract DeployTestnetTest is Test {
    TestStockToken nvda;
    TestAggregator feed;
    ExpiryCalendar calendar;
    AarkaFactory factory;
    AarkaSeries series;

    address deployer = address(this);
    address alice = makeAddr("alice");

    function setUp() public {
        // A plausible deployment moment: after the calendar starts, well before it ends.
        vm.warp(1_790_000_000); // 2026-09-21

        nvda = new TestStockToken("NVIDIA - Aarka Testnet", "NVDA", deployer);
        feed = new TestAggregator("RHNVDA / USD", 215e8, deployer);
        calendar = new ExpiryCalendar(deployer);
        factory = new AarkaFactory(deployer, calendar, AggregatorV3Interface(address(0)));

        uint64[] memory future = _futureExpiries();
        calendar.addExpiries(future);
        factory.registerAsset(address(nvda), AggregatorV3Interface(address(feed)));

        uint64 expiry;
        for (uint256 i; i < future.length; ++i) {
            if (future[i] > block.timestamp + 7 days) {
                expiry = future[i];
                break;
            }
        }
        series = AarkaSeries(factory.createSeries(address(nvda), 215e8, expiry));
    }

    function _futureExpiries() internal view returns (uint64[] memory future) {
        uint64[] memory all = NyseCalendar2026.expiries();
        uint256 n;
        for (uint256 i; i < all.length; ++i) {
            if (all[i] > block.timestamp) ++n;
        }
        future = new uint64[](n);
        uint256 k;
        for (uint256 i; i < all.length; ++i) {
            if (all[i] > block.timestamp) future[k++] = all[i];
        }
    }

    // ---------------------------------------------------------------- calendar

    function test_calendarIsDstCorrect() public pure {
        uint64[] memory e = NyseCalendar2026.expiries();
        assertEq(e.length, 52);
        // The boundary that a hard-coded UTC cadence would get wrong.
        assertEq(e[7], 1_792_785_600); // Fri 23 Oct 2026 16:00 EDT == 20:00 UTC
        assertEq(e[9], 1_793_998_800); // Fri 06 Nov 2026 16:00 EST == 21:00 UTC
        assertEq(e[9] - e[8], 7 days + 1 hours, "the clocks go back between these two");
    }

    function test_calendarSkipsMarketHolidays() public pure {
        uint64[] memory e = NyseCalendar2026.expiries();
        for (uint256 i; i < e.length; ++i) {
            assertTrue(e[i] % 1 days == 72_000 || e[i] % 1 days == 75_600, "16:00 ET, EDT or EST");
        }
    }

    function test_everyPublishedExpiryIsAccepted() public view {
        uint64[] memory e = NyseCalendar2026.expiries();
        uint256 accepted;
        for (uint256 i; i < e.length; ++i) {
            if (e[i] > block.timestamp) {
                assertTrue(calendar.isValidExpiry(e[i]));
                ++accepted;
            }
        }
        assertGt(accepted, 40, "most of the year should still be ahead");
    }

    // ---------------------------------------------------------------- deployment

    function test_seriesIsWiredToTheDeployedContracts() public view {
        assertEq(address(series.underlying()), address(nvda));
        assertEq(address(series.feed()), address(feed));
        assertEq(series.strike(), 215e8);
        assertTrue(series.hasOraclePause(), "the stand-in must expose oraclePaused like mainnet");
        assertEq(series.floorToken().symbol(), "fNVDA-215-02OCT26");
        assertEq(series.upsideToken().symbol(), "uNVDA-215-02OCT26");
    }

    function test_faucetLetsAnyoneStart() public {
        vm.prank(alice);
        nvda.claim();
        assertEq(nvda.balanceOf(alice), 100e18);

        vm.prank(alice);
        vm.expectRevert();
        nvda.claim(); // cooldown

        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        nvda.claim();
        assertEq(nvda.balanceOf(alice), 200e18);
    }

    // ---------------------------------------------------------------- lifecycle

    /// @notice The full path a judge would walk: claim, split, settle, claim both legs.
    function test_fullLifecycleOnTheDeployedStack() public {
        vm.prank(alice);
        nvda.claim();

        vm.startPrank(alice);
        nvda.approve(address(series), type(uint256).max);
        series.mint(100e18, alice);
        vm.stopPrank();

        assertEq(series.floorToken().balanceOf(alice), 100e18);
        assertEq(series.upsideToken().balanceOf(alice), 100e18);

        uint64 expiry = series.expiry();
        // Publish a settleable history: one round inside the window, one after expiry.
        feed.pushRoundAt(430e8, expiry - 20 minutes); // S = 2K, so each half is worth half a token
        feed.pushRoundAt(440e8, expiry + 10 minutes);

        vm.warp(expiry + 1);
        series.settle(feed.latestRound() - 1);
        assertEq(series.settlementPrice(), 430e8);

        vm.warp(block.timestamp + series.CHALLENGE_PERIOD());
        vm.startPrank(alice);
        uint256 paidFloor = series.claimFloor(100e18, alice);
        uint256 paidUpside = series.claimUpside(100e18, alice);
        vm.stopPrank();

        assertApproxEqRel(paidFloor, 50e18, 1e15);
        assertApproxEqRel(paidUpside, 50e18, 1e15);
        assertEq(paidFloor + paidUpside, 100e18, "conservation to the wei");
        assertEq(nvda.balanceOf(address(series)), 0);
    }

    /// @notice The stand-in reproduces the mainnet quirk: effectiveAt is not cleared when an
    ///         action is applied. If the mock cleared it, testnet would be easier to pass than
    ///         reality and the AAPL bug would not reappear here.
    function test_standInReproducesTheStaleEffectiveAt() public {
        nvda.scheduleCorporateAction(1.000566e18, block.timestamp + 1 days);
        vm.warp(block.timestamp + 2 days);
        nvda.applyCorporateAction();

        assertGt(nvda.effectiveAt(), 0, "effectiveAt survives, exactly as on mainnet");
        assertLt(nvda.effectiveAt(), block.timestamp);
        assertEq(nvda.uiMultiplier(), 1.000566e18);

        // And a series can still be created despite it.
        uint64[] memory future = _futureExpiries();
        uint64 later;
        for (uint256 i; i < future.length; ++i) {
            if (future[i] > block.timestamp + 30 days) {
                later = future[i];
                break;
            }
        }
        factory.createSeries(address(nvda), 220e8, later);
    }

    /// @notice A phase change makes roundId + 1 a well-formed id that does not exist, which is
    ///         the case the try/catch in _requireNoLaterRound exists for.
    function test_settlementSurvivesAnAggregatorPhaseChange() public {
        uint64 expiry = series.expiry();
        feed.pushRoundAt(300e8, expiry - 30 minutes);
        uint80 target = feed.latestRound();
        feed.advancePhase(); // roundId + 1 in the old phase now reverts

        vm.warp(expiry + 1);
        series.settle(target);
        assertEq(series.settlementPrice(), 300e8);
    }
}
