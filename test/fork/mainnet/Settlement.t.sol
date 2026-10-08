// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {MainnetBase} from "./MainnetBase.t.sol";
import {BrokenFeed, UpButNeverStartedFeed, HollowToken} from "./StandIns.sol";
import {AarkaSeries} from "../../../src/AarkaSeries.sol";
import {AggregatorV3Interface} from "../../../src/interfaces/IExternal.sol";

/// @notice Every rule `settle`, `challengeSettlement`, `mint`, `redeem` and the claims enforce,
///         against the real NVDA and TSLA tokens and the rounds Chainlink really published.
contract MainnetSettlementTest is MainnetBase {
    AarkaSeries nv; // NVDA $230, 2 Oct
    AarkaSeries ts; // TSLA $400, 2 Oct: closes out of the money for the upside

    function setUp() public {
        _forkA();
        nv = _create(NVDA, 230e8);
        ts = _create(TSLA, 400e8);
        _mintPair(nv, alice, 10e18);
        _mintPair(ts, alice, 4e18);
    }

    // ------------------------------------------------------------------ before the close

    function test_settleRefusesBeforeExpiry() public {
        vm.expectRevert(AarkaSeries.NotExpired.selector);
        nv.settle(NVDA_CLOSE_ROUND);
    }

    function test_mintGuards() public {
        vm.startPrank(alice);
        vm.expectRevert(AarkaSeries.ZeroAmount.selector);
        nv.mint(0, alice);
        vm.expectRevert(AarkaSeries.ZeroAddress.selector);
        nv.mint(1, address(0));
        vm.stopPrank();

        vm.warp(CLOSE_2OCT);
        vm.expectRevert(AarkaSeries.Expired.selector);
        vm.prank(alice);
        nv.mint(1, alice);
    }

    /// @dev Stand-in: a token that accepts the transfer and delivers nothing (a 100% transfer fee).
    function test_mintCountsWhatArrived_notWhatWasAsked() public {
        HollowToken hollow = new HollowToken();
        AarkaSeries s = new AarkaSeries(
            IERC20(address(hollow)), AggregatorV3Interface(NVDA_FEED), AggregatorV3Interface(address(0)), 230e8, CLOSE_2OCT
        );
        hollow.mint(alice, 1e18);
        vm.prank(alice);
        vm.expectRevert(AarkaSeries.ZeroAmount.selector);
        s.mint(1e18, alice);
    }

    function test_redeemGuardsAndRedeemAlwaysOpen() public {
        vm.startPrank(alice);
        vm.expectRevert(AarkaSeries.ZeroAmount.selector);
        nv.redeem(0, alice);
        vm.expectRevert(AarkaSeries.ZeroAddress.selector);
        nv.redeem(1, address(0));
        nv.redeem(1e18, bob);
        vm.stopPrank();
        assertEq(IERC20(NVDA).balanceOf(bob), 1e18, "one pair, one real share");
    }

    function test_claimsRefuseUntilSettled() public {
        vm.startPrank(alice);
        vm.expectRevert(AarkaSeries.NotSettled.selector);
        nv.claimFloor(1, alice);
        vm.expectRevert(AarkaSeries.NotSettled.selector);
        nv.claimUpside(1, alice);
        vm.stopPrank();
        vm.expectRevert(AarkaSeries.NotSettled.selector);
        nv.challengeSettlement(NVDA_CLOSE_ROUND);
    }

    // ------------------------------------------------------------------ after the close, real rounds

    function test_theRealCloseSettlesAndEverythingAfterwardIsGuarded() public {
        _toBlockB();
        _sequencerUpPastGrace();

        nv.settle(NVDA_CLOSE_ROUND);
        (uint256 fp, uint256 up) = nv.payouts();
        assertEq(fp, Math.mulDiv(230e8, 1e18, NVDA_CLOSE_PRICE));
        assertEq(fp + up, 1e18);
        assertEq(nv.settlementRoundId(), NVDA_CLOSE_ROUND);
        assertEq(nv.claimsUnlockAt(), block.timestamp + 1 hours);

        vm.expectRevert(AarkaSeries.AlreadySettled.selector);
        nv.settle(NVDA_CLOSE_ROUND);

        // Nothing later than the close round can be at or before the close.
        vm.expectRevert(AarkaSeries.RoundAfterExpiry.selector);
        nv.challengeSettlement(NVDA_CLOSE_ROUND + 1);
        vm.expectRevert(AarkaSeries.NotAnImprovement.selector);
        nv.challengeSettlement(NVDA_CLOSE_ROUND - 1);

        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(AarkaSeries.ChallengeWindowClosed.selector);
        nv.challengeSettlement(NVDA_CLOSE_ROUND);

        vm.startPrank(alice);
        vm.expectRevert(AarkaSeries.ZeroAmount.selector);
        nv.claimFloor(0, alice);
        vm.expectRevert(AarkaSeries.ZeroAddress.selector);
        nv.claimUpside(1, address(0));
        // Redeem still works after settlement: a pair is still exactly one share.
        nv.redeem(1e18, alice);
        vm.stopPrank();
    }

    function test_anUpsideThatFinishedBelowTheLineBurnsForNothing() public {
        _toBlockB();
        _sequencerUpPastGrace();
        ts.settle(TSLA_CLOSE_ROUND);
        vm.warp(block.timestamp + 1 hours);

        uint256 before = IERC20(TSLA).balanceOf(alice);
        vm.startPrank(alice);
        assertEq(ts.claimUpside(4e18, alice), 0, "TSLA closed at $370.45, under the $400 line");
        assertEq(ts.claimFloor(4e18, alice), 4e18, "so the floor takes the whole share");
        vm.stopPrank();
        assertEq(IERC20(TSLA).balanceOf(alice) - before, 4e18);
        assertEq(ts.upsideToken().totalSupply(), 0, "the worthless upsides were still burned");
    }

    function test_aRoundAfterTheCloseIsRefused() public {
        _toBlockB();
        _sequencerUpPastGrace();
        vm.expectRevert(AarkaSeries.RoundAfterExpiry.selector);
        nv.settle(NVDA_CLOSE_ROUND + 1);
    }

    /// @dev The round Chainlink published the morning of 1 Oct is real and before the close, but
    ///      more than 26 hours before it: too old for the normal path. And once the late path
    ///      opens, it is refused for a different reason, because a later round before the close
    ///      exists. Either way only the close round can settle.
    function test_anOldRoundIsRefusedOnBothPaths() public {
        _toBlockB();
        _sequencerUpPastGrace();
        uint80 old = _roundOlderThan(NVDA_FEED, NVDA_CLOSE_ROUND, CLOSE_2OCT - 26 hours);

        vm.expectRevert(AarkaSeries.RoundTooOld.selector);
        nv.settle(old);

        vm.warp(CLOSE_2OCT + 7 days);
        vm.expectRevert(AarkaSeries.LaterRoundExists.selector);
        nv.settle(old);
    }

    /// @dev Within 26 hours but not the last round before the close.
    function test_aRoundThatIsNotTheLastIsRefused() public {
        _toBlockB();
        _sequencerUpPastGrace();
        (,,, uint256 at,) = AggregatorV3Interface(NVDA_FEED).getRoundData(NVDA_CLOSE_ROUND - 1);
        assertLe(CLOSE_2OCT - at, 26 hours, "the previous round is recent enough");
        vm.expectRevert(AarkaSeries.LaterRoundExists.selector);
        nv.settle(NVDA_CLOSE_ROUND - 1);
    }

    /// @dev Aggregator round 0 does not exist. The real proxy answers it with zeros, not a revert.
    function test_aRoundThatDoesNotExistIsRefused() public {
        _toBlockB();
        _sequencerUpPastGrace();
        vm.expectRevert(AarkaSeries.InvalidPrice.selector);
        nv.settle(PHASE_1);
    }

    // ------------------------------------------------------------------ the guards on the normal path

    function test_sequencerChecks() public {
        _toBlockB();

        // The keeper's last report was a week ago: the feed has gone stale and reads as down.
        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        nv.settle(NVDA_CLOSE_ROUND);

        // The first report after a gap opens a new round, so the grace period starts now.
        vm.prank(reporter);
        sequencer.report(true);
        vm.expectRevert(AarkaSeries.SequencerGracePeriod.selector);
        nv.settle(NVDA_CLOSE_ROUND);

        // The keeper sees the chain down.
        vm.warp(block.timestamp + 2 hours);
        vm.prank(reporter);
        sequencer.report(false);
        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        nv.settle(NVDA_CLOSE_ROUND);
    }

    /// @dev Stand-in: a sequencer feed answering "up" with startedAt 0, which AarkaSequencerFeed
    ///      never produces but an uninitialised third-party feed can.
    function test_anUninitialisedSequencerFeedIsNotTrusted() public {
        UpButNeverStartedFeed blank = new UpButNeverStartedFeed();
        AarkaSeries s = new AarkaSeries(
            IERC20(NVDA), AggregatorV3Interface(NVDA_FEED), AggregatorV3Interface(address(blank)), 230e8, CLOSE_2OCT
        );
        _toBlockB(_one(address(s)));
        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        s.settle(NVDA_CLOSE_ROUND);
    }

    /// @dev The issuer's real oracle-pause role pauses NVDA. Settlement waits; unpausing releases it.
    function test_theIssuersOraclePauseHoldsSettlement() public {
        _toBlockB();
        _sequencerUpPastGrace();
        vm.prank(ISSUER_ORACLE_PAUSER);
        IStock(NVDA).pauseOracle();
        assertTrue(IStock(NVDA).oraclePaused());

        vm.expectRevert(AarkaSeries.OraclePaused.selector);
        nv.settle(NVDA_CLOSE_ROUND);

        vm.prank(ISSUER_ORACLE_PAUSER);
        IStock(NVDA).unpauseOracle();
        nv.settle(NVDA_CLOSE_ROUND);
    }

    /// @dev The issuer's real multiplier role schedules a corporate action half an hour before
    ///      the close, after the 17:07 UTC round that would otherwise settle the series. That
    ///      round may describe the token as it was before the action, so the normal path refuses
    ///      it; after a week the late path accepts it.
    function test_aCorporateActionAfterTheRoundHoldsSettlement() public {
        vm.prank(ISSUER_MULTIPLIER);
        IStock(NVDA).updateMultiplier(1.01e18, CLOSE_2OCT - 30 minutes);
        _toBlockB();
        _sequencerUpPastGrace();
        assertEq(IStock(NVDA).effectiveAt(), CLOSE_2OCT - 30 minutes);

        vm.expectRevert(AarkaSeries.CorporateActionBeforeExpiry.selector);
        nv.settle(NVDA_CLOSE_ROUND);

        vm.warp(CLOSE_2OCT + 7 days);
        nv.settle(NVDA_CLOSE_ROUND);
        assertTrue(nv.settledLate());
    }

    /// @dev A week after the close the series settles even with the sequencer feed dead and the
    ///      oracle paused. Every series resolves.
    function test_theLatePathSettlesWhateverElseIsWrong() public {
        _toBlockB();
        vm.warp(CLOSE_2OCT + 7 days);
        vm.prank(ISSUER_ORACLE_PAUSER);
        IStock(NVDA).pauseOracle();
        (, int256 up,,,) = sequencer.latestRoundData();
        assertEq(up, 1, "sequencer reads down");

        nv.settle(NVDA_CLOSE_ROUND);
        assertTrue(nv.settledLate());
        assertEq(nv.settlementPrice(), NVDA_CLOSE_PRICE, "and still at the real close");
    }

    /// @dev A series created with no sequencer feed skips the check entirely, and the round right
    ///      at the head of the real feed settles: the real proxy answers latest+1 with zeros.
    function test_theNewestRealRoundSettlesWithNoSequencerFeed() public {
        _toBlockB();
        (uint80 latest,,, uint256 at,) = AggregatorV3Interface(NVDA_FEED).latestRoundData();
        (,,, uint256 nextAt,) = AggregatorV3Interface(NVDA_FEED).getRoundData(latest + 1);
        assertEq(nextAt, 0, "the real proxy has no round after the latest");

        vm.expectEmit(false, false, false, false);
        emit AarkaSeries.SequencerCheckDisabled();
        AarkaSeries s = new AarkaSeries(
            IERC20(NVDA), AggregatorV3Interface(NVDA_FEED), AggregatorV3Interface(address(0)), 23_050_000_000, uint64(at + 1)
        );
        assertEq(s.floorToken().symbol(), "fNVDA-230.50-08OCT26");
        assertEq(s.floorToken().name(), "Aarka Floor NVDA 08OCT26 $230.50");
        vm.warp(at + 1);
        s.settle(latest);
        assertTrue(s.settled());
    }

    /// @dev USDG implements no corporate-action signal. A series on it settles on the normal path
    ///      against the real USDG/USD feed with that check simply absent.
    function test_aTokenWithoutCorporateActionsSettlesNormally() public {
        _toBlockB();
        address usdgFeed = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
        (uint80 latest, int256 answer,, uint256 at,) = AggregatorV3Interface(usdgFeed).latestRoundData();
        AarkaSeries s = new AarkaSeries(
            IERC20(USDG), AggregatorV3Interface(usdgFeed), AggregatorV3Interface(address(0)), 1e8, uint64(at + 1)
        );
        assertFalse(s.hasOraclePause());
        vm.warp(at + 1);
        s.settle(latest);
        assertEq(s.settlementPrice(), uint256(answer));
        assertFalse(s.settledLate());
    }

    // ------------------------------------------------------------------ a real Chainlink migration

    /// @notice The hole `challengeSettlement` exists for, replayed on Chainlink's own proxy.
    ///
    /// @dev Chainlink migrates the NVDA proxy to a new aggregator (phase 2) just before a close.
    ///      The last phase-1 round is real. Its successor id is still in phase 1, where the real
    ///      proxy answers zeros, so `settle` sees no later round and accepts it. But phase 2 has
    ///      already published a later round before the close. The challenge replaces the stale
    ///      price with it, and only inside the hour. The new aggregator is a stand-in; the proxy,
    ///      its owner and its routing are Chainlink's.
    function test_aChainlinkMigrationBeforeTheCloseIsCaughtByTheChallenge() public {
        _toBlockB();
        IEACProxy proxy = IEACProxy(NVDA_FEED);
        (uint80 lastPhase1, int256 oldPrice,, uint256 oldAt,) = proxy.latestRoundData();

        uint64 expiry = uint64(block.timestamp + 2 hours);
        AarkaSeries s = new AarkaSeries(
            IERC20(NVDA), AggregatorV3Interface(NVDA_FEED), AggregatorV3Interface(address(0)), 230e8, expiry
        );
        _mintPair(s, alice, 1e18);

        BrokenFeed phase2 = new BrokenFeed();
        phase2.setRevertOnMissing(false);
        vm.startPrank(proxy.owner());
        proxy.proposeAggregator(address(phase2));
        proxy.confirmAggregator(address(phase2));
        vm.stopPrank();
        assertEq(proxy.phaseId(), 2, "the real proxy has migrated");

        vm.warp(expiry - 10 minutes);
        phase2.push(1, 250e8, block.timestamp);
        uint80 phase2Round = uint80((uint256(2) << 64) | 1);

        vm.warp(expiry + 1);
        s.settle(lastPhase1);
        assertEq(s.settlementPrice(), uint256(oldPrice), "the stale phase-1 price got in");
        assertEq(s.settlementUpdatedAt(), oldAt);

        // A round that is later but still not an improvement on itself, and one after expiry.
        vm.expectRevert(AarkaSeries.NotAnImprovement.selector);
        s.challengeSettlement(lastPhase1);

        s.challengeSettlement(phase2Round);
        assertEq(s.settlementPrice(), 250e8, "the challenge put the real last price in");
        assertEq(s.settlementRoundId(), phase2Round);
        assertEq(s.floorPayoutPerUnit(), Math.mulDiv(230e8, 1e18, 250e8));
    }

    // ------------------------------------------------------------------ stand-in feeds

    /// @dev Stand-in feeds for what a live Chainlink feed cannot be made to do on demand.
    function test_brokenFeedsAreRefused() public {
        _toBlockB();
        uint64 expiry = uint64(block.timestamp - 1 hours);
        BrokenFeed f = new BrokenFeed();
        AarkaSeries s = new AarkaSeries(
            IERC20(NVDA), AggregatorV3Interface(address(f)), AggregatorV3Interface(address(0)), 230e8, expiry
        );

        // A round with a price and no timestamp.
        f.push(10, 230e8, 0);
        vm.expectRevert(AarkaSeries.IncompleteRound.selector);
        s.settle(10);

        // The feed changed its decimals after the series was written.
        f.setDecimals(18);
        vm.expectRevert(AarkaSeries.UnexpectedFeedDecimals.selector);
        s.settle(10);
        f.setDecimals(8);

        // The last possible round id: there is no successor to check.
        f.push(type(uint80).max, 230e8, expiry - 1);
        vm.expectRevert(AarkaSeries.RoundIdOverflow.selector);
        s.settle(type(uint80).max);

        // An older aggregator reverts on a missing successor instead of answering zeros. That is
        // the absence of a later round, not an error.
        f.push(20, 231e8, expiry - 1);
        s.settle(20);
        assertEq(s.settlementPrice(), 231e8);
    }

    // ------------------------------------------------------------------ helpers

    function _roundOlderThan(address feed, uint80 from, uint256 cutoff) internal view returns (uint80 r) {
        r = from;
        while (true) {
            (,,, uint256 at,) = AggregatorV3Interface(feed).getRoundData(r);
            if (at < cutoff) return r;
            --r;
        }
    }

    function _one(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }
}

interface IStock {
    function pauseOracle() external;
    function unpauseOracle() external;
    function oraclePaused() external view returns (bool);
    function updateMultiplier(uint256 newMultiplier, uint256 effectiveAt) external;
    function effectiveAt() external view returns (uint256);
}

interface IEACProxy {
    function owner() external view returns (address);
    function proposeAggregator(address) external;
    function confirmAggregator(address) external;
    function phaseId() external view returns (uint16);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}
