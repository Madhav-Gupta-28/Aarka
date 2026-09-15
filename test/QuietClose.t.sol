// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./Base.t.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AarkaToken} from "../src/AarkaToken.sol";

/// @notice AUDIT-16 and AUDIT-17, fixed.
///
/// @dev AUDIT-16: settlement used to accept only a round from the six hours before expiry. A quiet
///      close publishes nothing in that window, the series could then never settle, and a holder of
///      one half had no way out. These tests replay that and prove every series now resolves.
contract QuietCloseTest is BaseTest {
    /// @notice The measured case. SPY's last round before the 11 Sep 2026 close was published at
    ///         12:56 UTC and the close was 20:00 UTC: 7 hours 4 minutes. That series used to be
    ///         permanently unsettleable.
    function test_AUDIT16_theSevenHourSpyGapNowSettles() public {
        feed.pushRound(200, 250e8, EXPIRY - (7 hours + 4 minutes));
        vm.warp(EXPIRY + 1);
        series.settle(200);
        assertTrue(series.settled());
        assertFalse(series.settledLate(), "a quiet close is the normal path, not the fallback");
    }

    /// @notice The property that matters: someone who sold one half, and kept the other, gets paid.
    function test_AUDIT16_aOneHalfHolderIsPaidAfterAQuietClose() public {
        vm.prank(alice);
        series.mint(100e18, alice);
        vm.prank(alice);
        u.transfer(bob, 100e18); // alice sold the upside; she holds the floor alone

        feed.pushRound(200, 250e8, EXPIRY - 20 hours); // a heartbeat round, nothing since
        vm.warp(EXPIRY + 1);
        series.settle(200);
        vm.warp(block.timestamp + series.CHALLENGE_PERIOD());

        uint256 before = nvda.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = series.claimFloor(100e18, alice);
        assertEq(nvda.balanceOf(alice) - before, paid);
        assertEq(paid, uint256(100e18) * 230 / 250, "floor pays min(S, K) / S");
    }

    /// @notice Past the delay, age no longer matters. The feed that went quiet for three days
    ///         before expiry still resolves the series.
    function test_AUDIT16_lateSettlementAcceptsAnOldRound() public {
        feed.pushRound(200, 250e8, EXPIRY - 3 days);

        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.RoundTooOld.selector);
        series.settle(200);

        vm.warp(EXPIRY + series.LATE_SETTLEMENT_DELAY());
        series.settle(200);
        assertTrue(series.settledLate());
        assertEq(series.settlementPrice(), 250e8);
    }

    /// @notice A paused asset and a down sequencer block the normal path, and keep blocking it for
    ///         a week. After that they would strand one-half holders forever, so they stop counting.
    function test_AUDIT16_lateSettlementIgnoresPauseAndSequencer() public {
        feed.pushRound(200, 250e8, EXPIRY - 1 hours);
        nvda.setOraclePaused(true);
        seq.set(1, 1); // down

        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        series.settle(200);

        seq.set(0, 1); // back up, but the asset is still paused
        vm.expectRevert(AarkaSeries.OraclePaused.selector);
        series.settle(200);

        seq.set(1, 1);
        vm.warp(EXPIRY + series.LATE_SETTLEMENT_DELAY());
        series.settle(200);
        assertTrue(series.settledLate());
    }

    /// @notice The late path still pins the round. It relaxes age, not correctness.
    function test_AUDIT16_lateSettlementStillRejectsAnEarlierRound() public {
        feed.pushRound(200, 250e8, EXPIRY - 3 days);
        feed.pushRound(201, 260e8, EXPIRY - 2 days);
        vm.warp(EXPIRY + series.LATE_SETTLEMENT_DELAY());
        vm.expectRevert(AarkaSeries.LaterRoundExists.selector);
        series.settle(200);
        series.settle(201);
    }

    /// @notice What the six-hour bound used to do implicitly, now done explicitly: a corporate
    ///         action that landed after the settlement round blocks the normal path.
    function test_AUDIT16_aCorporateActionAfterTheRoundBlocksTheNormalPath() public {
        feed.pushRound(200, 250e8, EXPIRY - 10 hours);
        nvda.scheduleCorporateAction(4e18, EXPIRY - 2 hours);

        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.CorporateActionBeforeExpiry.selector);
        series.settle(200);

        vm.warp(EXPIRY + series.LATE_SETTLEMENT_DELAY());
        series.settle(200);
        assertTrue(series.settledLate());
    }

    /// @notice An action that landed before the round is history, and does not block anything.
    function test_AUDIT16_anActionBeforeTheRoundDoesNotBlock() public {
        nvda.scheduleCorporateAction(4e18, EXPIRY - 12 hours);
        feed.pushRound(200, 250e8, EXPIRY - 10 hours);
        vm.warp(EXPIRY + 1);
        series.settle(200);
        assertFalse(series.settledLate());
    }

    // ---------------------------------------------------------------- AUDIT-17

    function test_AUDIT17_twoStrikesOnOneExpiryHaveDifferentSymbols() public {
        AarkaSeries other = AarkaSeries(factory.createSeries(address(nvda), 240e8, EXPIRY));
        assertEq(f.symbol(), "fNVDA-230-25SEP26");
        assertEq(other.floorToken().symbol(), "fNVDA-240-25SEP26");
        assertEq(other.upsideToken().symbol(), "uNVDA-240-25SEP26");
    }

    function test_AUDIT17_centStrikesRenderToTheCent() public {
        AarkaSeries cents = AarkaSeries(factory.createSeries(address(nvda), 212_50e6, EXPIRY));
        assertEq(cents.floorToken().symbol(), "fNVDA-212.50-25SEP26");
        AarkaSeries oneCent = AarkaSeries(factory.createSeries(address(nvda), 212_01e6, EXPIRY));
        assertEq(oneCent.upsideToken().symbol(), "uNVDA-212.01-25SEP26");
        assertEq(oneCent.upsideToken().name(), "Aarka Upside NVDA 25SEP26 $212.01");
    }

    function test_AUDIT17_subCentStrikesAreRefused() public {
        vm.expectRevert(AarkaFactory.InvalidStrike.selector);
        factory.createSeries(address(nvda), 212_00_000_001, EXPIRY);
    }
}
