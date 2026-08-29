// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./Base.t.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";

contract SettlementTest is BaseTest {
    function setUp() public override {
        super.setUp();
        vm.prank(alice);
        series.mint(100e18, alice);
    }

    // ---------------------------------------------------------------- timing

    function test_cannotSettleBeforeExpiry() public {
        _publishSettlementRounds(250e8);
        vm.expectRevert(AarkaSeries.NotExpired.selector);
        series.settle(200);
    }

    function test_cannotSettleTwice() public {
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);
        series.settle(200);
        vm.expectRevert(AarkaSeries.AlreadySettled.selector);
        series.settle(200);
    }

    // ---------------------------------------------------------------- round pinning

    /// @dev The core anti-manipulation property: the caller picks when, never what price.
    function test_rejectsRoundPublishedAfterExpiry() public {
        feed.pushRound(200, 250e8, EXPIRY + 1 minutes);
        vm.warp(EXPIRY + 1 hours);
        vm.expectRevert(AarkaSeries.RoundAfterExpiry.selector);
        series.settle(200);
    }

    /// @dev Also the corporate-action pause detector and the off-hours detector. While the feed
    ///      is not publishing, no round exists inside the window and settlement blocks itself.
    function test_rejectsRoundOlderThanTheLookback() public {
        feed.pushRound(200, 250e8, EXPIRY - 7 hours);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.RoundTooOld.selector);
        series.settle(200);
    }

    function test_acceptsRoundExactlyAtTheLookbackBound() public {
        feed.pushRound(200, 250e8, EXPIRY - 6 hours);
        vm.warp(EXPIRY + 1);
        series.settle(200);
        assertEq(series.settlementPrice(), 250e8);
    }

    /// @dev Stops a caller presenting an early round to pick a better price for their leg.
    function test_rejectsRoundWhenALaterOneExistsBeforeExpiry() public {
        feed.pushRound(200, 250e8, EXPIRY - 2 hours);
        feed.pushRound(201, 300e8, EXPIRY - 1 hours);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.LaterRoundExists.selector);
        series.settle(200);
    }

    /// @dev The phase-boundary path. A Chainlink proxy reverts on a well-formed round id that
    ///      does not exist; without the try/catch this series would be unsettleable forever.
    function test_settlesWhenSuccessorRoundReverts() public {
        feed.pushRound(200, 250e8, EXPIRY - 30 minutes);
        feed.setReverting(201);
        vm.warp(EXPIRY + 1);
        series.settle(200);
        assertEq(series.settlementPrice(), 250e8);
    }

    function test_rejectsNonPositivePrice() public {
        feed.pushRound(200, 0, EXPIRY - 30 minutes);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.InvalidPrice.selector);
        series.settle(200);
    }

    // ---------------------------------------------------------------- feed sanity

    function test_rejectsUnexpectedFeedDecimals() public {
        _publishSettlementRounds(250e8);
        feed.setDecimals(18);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.UnexpectedFeedDecimals.selector);
        series.settle(200);
    }

    function test_rejectsWhileTheOracleIsPaused() public {
        _publishSettlementRounds(250e8);
        nvda.setOraclePaused(true);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.OraclePaused.selector);
        series.settle(200);
    }

    // ---------------------------------------------------------------- sequencer

    function test_rejectsWhileTheSequencerIsDown() public {
        _publishSettlementRounds(250e8);
        seq.set(1, 1);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        series.settle(200);
    }

    function test_rejectsInsideTheSequencerGracePeriod() public {
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);
        seq.set(0, block.timestamp - 30 minutes); // back up, but only just
        vm.expectRevert(AarkaSeries.SequencerGracePeriod.selector);
        series.settle(200);
    }

    function test_acceptsOnceTheGracePeriodHasElapsed() public {
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);
        seq.set(0, block.timestamp - 2 hours);
        series.settle(200);
        assertTrue(series.settled());
    }

    // ---------------------------------------------------------------- challenge window

    function test_challengeMovesSettlementTowardsExpiry() public {
        feed.pushRound(200, 250e8, EXPIRY - 3 hours);
        feed.setReverting(201); // fake a phase boundary so the wrong round slips through
        feed.pushRound(210, 260e8, EXPIRY - 10 minutes);
        feed.setReverting(211);

        vm.warp(EXPIRY + 1);
        series.settle(200);
        assertEq(series.settlementPrice(), 250e8);

        series.challengeSettlement(210);
        assertEq(series.settlementPrice(), 260e8);
        assertEq(series.settlementUpdatedAt(), EXPIRY - 10 minutes);
    }

    function test_challengeRejectsAnEarlierRound() public {
        feed.pushRound(190, 240e8, EXPIRY - 4 hours);
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);
        series.settle(200);

        vm.expectRevert(AarkaSeries.NotAnImprovement.selector);
        series.challengeSettlement(190);
    }

    function test_challengeRejectsARoundAfterExpiry() public {
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);
        series.settle(200);

        vm.expectRevert(AarkaSeries.RoundAfterExpiry.selector);
        series.challengeSettlement(201);
    }

    /// @dev Bounded: no amount of challenging can delay claims past one hour.
    function test_challengeWindowClosesAndIsNotExtended() public {
        feed.pushRound(200, 250e8, EXPIRY - 3 hours);
        feed.setReverting(201);
        feed.pushRound(210, 260e8, EXPIRY - 10 minutes);
        feed.setReverting(211);

        vm.warp(EXPIRY + 1);
        series.settle(200);
        uint64 unlock = series.claimsUnlockAt();

        series.challengeSettlement(210);
        assertEq(series.claimsUnlockAt(), unlock, "challenge must not extend the window");

        vm.warp(unlock);
        vm.expectRevert(AarkaSeries.ChallengeWindowClosed.selector);
        series.challengeSettlement(210);
    }

    function test_cannotChallengeBeforeSettlement() public {
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.NotSettled.selector);
        series.challengeSettlement(200);
    }
}
