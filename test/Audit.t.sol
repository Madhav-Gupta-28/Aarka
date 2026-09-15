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

        // Past the late-settlement delay the sequencer and the pause are no longer required, but a
        // feed reporting the wrong decimals still is: a mis-scaled price is not a late price, it is
        // a wrong one. So this one stays unsettleable, and pairs remain the way out.
        vm.expectRevert(AarkaSeries.UnexpectedFeedDecimals.selector);
        s.settle(200);

        vm.prank(alice);
        s.redeem(100e18, alice);
        assertEq(nvda.balanceOf(alice), 1_000e18, "every token back, no admin involved");
    }

    /// @notice The two resolvers answer different questions and must be used for different things.
    ///         `seriesFor` is authoritative once a series exists; `predictSeries` is only a
    ///         prediction and legitimately moves when governance changes the registry.
    function test_resolverSemantics() public {
        // Before deployment the two agree, because there is nothing recorded yet.
        _addExpiry(EXPIRY2);
        address predicted = factory.predictSeries(address(nvda), 240e8, EXPIRY2);
        assertEq(factory.seriesFor(address(nvda), 240e8, EXPIRY2), predicted);
        assertEq(predicted.code.length, 0);

        address created = factory.createSeries(address(nvda), 240e8, EXPIRY2);
        assertEq(created, predicted, "the prediction was right");
        assertEq(factory.deployedSeries(keccak256(abi.encode(address(nvda), uint256(240e8), EXPIRY2))), created);

        // After a registry change the prediction moves. The record does not.
        MockSequencerFeed seq2 = new MockSequencerFeed();
        vm.prank(owner);
        factory.setSequencerFeed(AggregatorV3Interface(address(seq2)));

        assertTrue(factory.predictSeries(address(nvda), 240e8, EXPIRY2) != created, "prediction moved");
        assertEq(factory.seriesFor(address(nvda), 240e8, EXPIRY2), created, "the record did not");
    }

    /// @notice AUDIT-15. A feed reporting a timestamp in the future made the freshness check in
    ///         `_requireStrikeInBand` underflow and panic rather than revert with a name. Found on
    ///         the live testnet deployment after a round was published with a future date: creating
    ///         any new series panicked with 0x11 instead of failing cleanly.
    ///
    ///         Same defect as AUDIT-06, which was fixed for the sequencer feed and missed here.
    function test_AUDIT15_futureDatedSpotIsRefusedCleanly() public {
        _addExpiry(EXPIRY2);
        feed.pushRound(500, 215e8, block.timestamp + 30 days);

        vm.expectRevert(AarkaFactory.SpotUnavailable.selector);
        factory.createSeries(address(nvda), 240e8, EXPIRY2);
    }
}
