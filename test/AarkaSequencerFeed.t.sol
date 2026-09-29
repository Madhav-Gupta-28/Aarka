// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {AarkaSequencerFeed} from "../src/adapters/AarkaSequencerFeed.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

/// @notice The stopgap uptime feed, and the guard it switches back on.
///
/// @dev Robinhood Chain publishes no sequencer uptime feed, so Aarka's sequencer guard has shipped
///      disabled. These tests cover the feed itself and, more importantly, what it does to
///      settlement: it can block it, it can delay it, and after the late-settlement delay it stops
///      mattering — which is what bounds the trust placed in a single keeper.
contract AarkaSequencerFeedTest is Test {
    uint256 constant NOW = 1_790_000_000;
    uint64 constant EXPIRY = 1_790_366_400;
    uint256 constant STRIKE = 230e8;

    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");

    AarkaSequencerFeed seq;
    MockAggregator price;
    MockStockToken nvda;
    AarkaSeries series;

    function setUp() public {
        vm.warp(NOW);
        seq = new AarkaSequencerFeed(owner, keeper);
        price = new MockAggregator();
        price.pushRound(100, 215e8, NOW - 60);
        nvda = new MockStockToken("Robinhood NVDA", "NVDA");

        series = new AarkaSeries(
            IERC20(address(nvda)), AggregatorV3Interface(address(price)),
            AggregatorV3Interface(address(seq)), STRIKE, EXPIRY
        );

        nvda.mint(alice, 100e18);
        vm.startPrank(alice);
        nvda.approve(address(series), type(uint256).max);
        series.mint(100e18, alice);
        vm.stopPrank();

        price.pushRound(200, 250e8, EXPIRY - 30 minutes);
    }

    // ---------------------------------------------------------------- the feed

    function test_reportsInChainlinksShape() public {
        vm.prank(keeper);
        seq.report(true);

        (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt,) = seq.latestRoundData();
        assertEq(id, 1);
        assertEq(answer, 0, "zero means up, as Chainlink has it");
        assertEq(startedAt, NOW);
        assertEq(updatedAt, NOW);
        assertEq(seq.decimals(), 0);
        assertTrue(seq.isFresh());
    }

    /// @dev An unchanged status refreshes the round rather than opening a new one, so `startedAt`
    ///      keeps pointing at when the chain actually came up.
    function test_repeatedReportsKeepTheSameRound() public {
        vm.prank(keeper);
        seq.report(true);
        vm.warp(NOW + 30 minutes);
        vm.prank(keeper);
        seq.report(true);

        (uint80 id,, uint256 startedAt, uint256 updatedAt,) = seq.latestRoundData();
        assertEq(id, 1, "same round");
        assertEq(startedAt, NOW, "still dated from when it came up");
        assertEq(updatedAt, NOW + 30 minutes, "but confirmed just now");
    }

    function test_aStatusChangeOpensANewRound() public {
        vm.startPrank(keeper);
        seq.report(true);
        vm.warp(NOW + 1 hours);
        seq.report(false);
        vm.stopPrank();

        (uint80 id, int256 answer, uint256 startedAt,,) = seq.latestRoundData();
        assertEq(id, 2);
        assertEq(answer, 1, "one means down");
        assertEq(startedAt, NOW + 1 hours);

        // The earlier round is still readable, unchanged.
        (, int256 firstAnswer,,,) = seq.getRoundData(1);
        assertEq(firstAnswer, 0);
    }

    /// @dev The property that makes a single keeper tolerable: silence is not an endorsement.
    function test_aDeadKeeperReadsAsDown() public {
        vm.prank(keeper);
        seq.report(true);

        vm.warp(NOW + seq.MAX_REPORT_AGE());
        (, int256 stillUp,,,) = seq.latestRoundData();
        assertEq(stillUp, 0, "inside the window, still up");
        assertTrue(seq.isFresh());

        vm.warp(NOW + seq.MAX_REPORT_AGE() + 1);
        (, int256 answer,,,) = seq.latestRoundData();
        assertEq(answer, 1, "past it, reported down rather than vouched for");
        assertFalse(seq.isFresh());
    }

    function test_beforeAnyReportItReadsAsDown() public view {
        (uint80 id, int256 answer, uint256 startedAt,,) = seq.latestRoundData();
        assertEq(id, 0);
        assertEq(answer, 1);
        assertEq(startedAt, 0);
    }

    function test_onlyTheReporterReports() public {
        vm.expectRevert(AarkaSequencerFeed.NotReporter.selector);
        seq.report(true);

        vm.prank(owner);
        seq.setReporter(alice);
        vm.prank(alice);
        seq.report(true);
        assertEq(seq.latestRound(), 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        seq.setReporter(alice);
    }

    function test_unknownRoundsRevert() public {
        vm.expectRevert(AarkaSequencerFeed.NoDataPresent.selector);
        seq.getRoundData(1);
    }

    // ---------------------------------------------------------------- the guard it restores

    function test_settlementWorksWhileTheSequencerIsUp() public {
        vm.prank(keeper);
        seq.report(true);

        // Four days pass, and the keeper keeps reporting, as it does every half hour.
        for (uint256 t = NOW + 30 minutes; t <= EXPIRY + 1; t += 30 minutes) {
            vm.warp(t);
            vm.prank(keeper);
            seq.report(true);
        }
        vm.warp(EXPIRY + 1);

        series.settle(200);
        assertTrue(series.settled());

        (,, uint256 startedAt,,) = seq.latestRoundData();
        assertEq(startedAt, NOW, "up since the first report, so the grace period is long past");
    }

    function test_settlementIsBlockedWhileDown() public {
        vm.prank(keeper);
        seq.report(false);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        series.settle(200);
    }

    /// @dev The whole point of the feed: after a restart, nobody settles until holders have had an
    ///      hour to act on a chain they could not reach.
    function test_aRestartHoldsSettlementForTheGracePeriod() public {
        vm.startPrank(keeper);
        seq.report(false);
        vm.warp(EXPIRY + 1);
        seq.report(true); // the chain comes back at expiry
        vm.stopPrank();

        vm.expectRevert(AarkaSeries.SequencerGracePeriod.selector);
        series.settle(200);

        vm.warp(block.timestamp + series.SEQUENCER_GRACE_PERIOD() + 1);
        vm.prank(keeper);
        seq.report(true);
        series.settle(200);
        assertTrue(series.settled());
    }

    function test_aDeadKeeperBlocksSettlementToo() public {
        vm.prank(keeper);
        seq.report(true);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        series.settle(200); // the last report is days old by now
    }

    /// @dev And the bound on all of it. A reporter that lies, breaks or disappears can delay
    ///      settlement by a week and no longer.
    function test_theLatePathIgnoresTheFeedEntirely() public {
        vm.prank(keeper);
        seq.report(false); // stuck reporting down forever

        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        series.settle(200);

        vm.warp(EXPIRY + series.LATE_SETTLEMENT_DELAY());
        series.settle(200);
        assertTrue(series.settled());
        assertTrue(series.settledLate(), "settled without the sequencer's blessing");
    }

    /// @dev AUDIT-25. The keeper goes quiet, readers see "down", and the keeper comes back saying
    ///      "up". Nobody watched the chain in between, so the status is dated from the report that
    ///      ended the gap and the grace period runs again. Refreshing the old round instead carried
    ///      its startedAt forward and let settlement through on the first report after the gap.
    function test_aReportAfterAGapRestartsTheGracePeriod() public {
        vm.prank(keeper);
        seq.report(true);

        vm.warp(EXPIRY + 1);
        (, int256 during,,,) = seq.latestRoundData();
        assertEq(during, 1, "readers were told down for the whole gap");

        vm.prank(keeper);
        uint80 id = seq.report(true);
        assertEq(id, 2, "a new round, not a refresh of the stale one");
        (,, uint256 startedAt,,) = seq.latestRoundData();
        assertEq(startedAt, EXPIRY + 1, "up since the report that ended the gap");

        vm.expectRevert(AarkaSeries.SequencerGracePeriod.selector);
        series.settle(200);

        vm.warp(block.timestamp + series.SEQUENCER_GRACE_PERIOD() + 1);
        vm.prank(keeper);
        seq.report(true);
        series.settle(200);
        assertTrue(series.settled());
    }

    /// @dev Inside MAX_REPORT_AGE an unchanged status still refreshes the round it is in.
    function test_aTimelyReportStillRefreshes() public {
        vm.prank(keeper);
        seq.report(true);
        vm.warp(NOW + seq.MAX_REPORT_AGE());
        vm.prank(keeper);
        assertEq(seq.report(true), 1);
    }
}
