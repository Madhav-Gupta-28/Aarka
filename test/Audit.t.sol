// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./Base.t.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {MockAggregator, MockSequencerFeed} from "./mocks/MockAggregator.sol";

/// @notice Adversarial probes written during the pre-frontend audit.
contract AuditTest is BaseTest {
    uint64 constant EXPIRY2 = 1_790_971_200;

    function _addExpiry(uint64 t) internal {
        uint64[] memory d = new uint64[](1);
        d[0] = t;
        vm.prank(owner);
        calendar.addExpiries(d);
    }

    /// @notice AUDIT-01. `seriesFor` derives the address from mutable factory state, so any
    ///         governance change to the sequencer feed silently invalidates it for every series
    ///         that already exists.
    function test_AUDIT01_seriesForBreaksAfterASequencerFeedChange() public {
        assertEq(factory.seriesFor(address(nvda), STRIKE, EXPIRY), address(series), "correct before");

        MockSequencerFeed seq2 = new MockSequencerFeed();
        vm.prank(owner);
        factory.setSequencerFeed(AggregatorV3Interface(address(seq2)));

        assertEq(
            factory.seriesFor(address(nvda), STRIKE, EXPIRY),
            address(series),
            "FIXED: a deployed series resolves from the record, not from mutable state"
        );
    }

    /// @notice AUDIT-02. The duplicate guard reads the same broken resolver, so after a governance
    ///         change the same (underlying, strike, expiry) can be deployed a second time. Two
    ///         series then exist with byte-identical names and symbols but different oracles.
    function test_AUDIT02_duplicateSeriesBecomesPossible() public {
        vm.expectRevert(AarkaFactory.SeriesExists.selector);
        factory.createSeries(address(nvda), STRIKE, EXPIRY);

        MockSequencerFeed seq2 = new MockSequencerFeed();
        vm.prank(owner);
        factory.setSequencerFeed(AggregatorV3Interface(address(seq2)));

        vm.expectRevert(AarkaFactory.SeriesExists.selector);
        factory.createSeries(address(nvda), STRIKE, EXPIRY);
        assertEq(factory.seriesCount(), 1, "FIXED: still exactly one series for these terms");
    }

    /// @notice AUDIT-03. Same class of failure via the asset registry rather than the sequencer.
    ///         A repointed feed produces a twin whose settlement price comes from a different
    ///         oracle entirely, while presenting the identical ticker to a user.
    function test_AUDIT03_repointedFeedProducesATwinOnADifferentOracle() public {
        MockAggregator rogue = new MockAggregator();
        rogue.pushRound(1, 215e8, NOW - 60);
        vm.prank(owner);
        factory.registerAsset(address(nvda), AggregatorV3Interface(address(rogue)));

        vm.expectRevert(AarkaFactory.SeriesExists.selector);
        factory.createSeries(address(nvda), STRIKE, EXPIRY);
        assertEq(address(series.feed()), address(feed), "FIXED: the original keeps its oracle");
    }

    /// @notice AUDIT-05. A sequencer uptime feed that has never reported returns
    ///         `(answer 0, startedAt 0)`. Answer 0 means "up", and `block.timestamp - 0` clears any
    ///         grace period, so an uninitialised feed used to sail through the check while proving
    ///         nothing at all about the sequencer.
    function test_AUDIT05_uninitialisedSequencerFeedIsNotTreatedAsHealthy() public {
        MockSequencerFeed blank = new MockSequencerFeed();
        blank.set(0, 0); // never reported: answer 0, startedAt 0

        AarkaSeries s = new AarkaSeries(
            nvda, AggregatorV3Interface(address(feed)), AggregatorV3Interface(address(blank)), STRIKE, EXPIRY
        );
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);

        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        s.settle(200);
    }

    /// @notice AUDIT-06. A future-dated startedAt used to underflow, reverting with a panic rather
    ///         than a named error. It now refuses cleanly, which is the same safe outcome with a
    ///         diagnosable reason.
    function test_AUDIT06_futureDatedSequencerFeedIsRefusedCleanly() public {
        MockSequencerFeed skewed = new MockSequencerFeed();
        skewed.set(0, block.timestamp + 30 days);

        AarkaSeries s = new AarkaSeries(
            nvda, AggregatorV3Interface(address(feed)), AggregatorV3Interface(address(skewed)), STRIKE, EXPIRY
        );
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);

        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        s.settle(200);
    }

    /// @notice AUDIT-07. Even with every oracle guard failing, principal is never trapped. This is
    ///         the property the whole no-admin design rests on, asserted directly.
    function test_AUDIT07_principalIsRecoverableWithEveryOracleGuardFailing() public {
        MockSequencerFeed blank = new MockSequencerFeed();
        blank.set(1, 0); // sequencer reported down

        AarkaSeries s = new AarkaSeries(
            nvda, AggregatorV3Interface(address(feed)), AggregatorV3Interface(address(blank)), STRIKE, EXPIRY
        );
        vm.startPrank(alice);
        nvda.approve(address(s), type(uint256).max);
        s.mint(100e18, alice);
        vm.stopPrank();

        feed.setDecimals(18);       // feed corrupted
        nvda.setOraclePaused(true); // asset paused
        vm.warp(EXPIRY + 400 days); // long past expiry, unsettleable

        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        s.settle(200);

        vm.prank(alice);
        s.redeem(100e18, alice);
        assertEq(nvda.balanceOf(alice), 1_000e18, "every token back, no admin involved");
    }
}
