// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./Base.t.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AarkaToken} from "../src/AarkaToken.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {BlackHoleToken} from "./mocks/MockStockToken.sol";

/// @notice Input guards and access control. Individually dull, collectively the difference
///         between a contract that fails safe and one that fails open.
contract GuardsTest is BaseTest {
    // ---------------------------------------------------------------- token access control

    function test_onlyTheSeriesCanMintAHalf() public {
        vm.prank(bob);
        vm.expectRevert(AarkaToken.NotSeries.selector);
        f.mint(bob, 1e18);
    }

    function test_onlyTheSeriesCanBurnAHalf() public {
        vm.prank(alice);
        series.mint(10e18, alice);
        vm.prank(bob);
        vm.expectRevert(AarkaToken.NotSeries.selector);
        f.burn(alice, 1e18);
    }

    function test_tokensKnowTheirSeries() public view {
        assertEq(f.series(), address(series));
        assertEq(u.series(), address(series));
    }

    // ---------------------------------------------------------------- input guards

    function test_mintRejectsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(AarkaSeries.ZeroAmount.selector);
        series.mint(0, alice);
    }

    function test_mintRejectsZeroAddress() public {
        vm.prank(alice);
        vm.expectRevert(AarkaSeries.ZeroAddress.selector);
        series.mint(1e18, address(0));
    }

    function test_redeemRejectsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(AarkaSeries.ZeroAmount.selector);
        series.redeem(0, alice);
    }

    function test_redeemRejectsZeroAddress() public {
        vm.prank(alice);
        series.mint(1e18, alice);
        vm.prank(alice);
        vm.expectRevert(AarkaSeries.ZeroAddress.selector);
        series.redeem(1e18, address(0));
    }

    function test_claimRejectsZeroAmount() public {
        vm.prank(alice);
        series.mint(10e18, alice);
        _settleAt(250e8);
        vm.prank(alice);
        vm.expectRevert(AarkaSeries.ZeroAmount.selector);
        series.claimFloor(0, alice);
    }

    function test_claimRejectsZeroAddress() public {
        vm.prank(alice);
        series.mint(10e18, alice);
        _settleAt(250e8);
        vm.prank(alice);
        vm.expectRevert(AarkaSeries.ZeroAddress.selector);
        series.claimUpside(1e18, address(0));
    }

    function test_claimRevertsBeforeSettlement() public {
        vm.prank(alice);
        series.mint(10e18, alice);
        vm.prank(alice);
        vm.expectRevert(AarkaSeries.NotSettled.selector);
        series.claimFloor(1e18, alice);
    }

    // ---------------------------------------------------------------- oracle edge cases

    function test_rejectsAnIncompleteRound() public {
        feed.pushRound(200, 250e8, 0); // answer set, updatedAt zero
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.IncompleteRound.selector);
        series.settle(200);
    }

    /// @dev A non-existent round id returns zeroes rather than reverting, and must be refused
    ///      on the price check before anything reads updatedAt.
    function test_rejectsAnUnknownRound() public {
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.InvalidPrice.selector);
        series.settle(9999);
    }

    function test_rejectsRoundIdOverflow() public {
        feed.pushRound(type(uint80).max, 250e8, EXPIRY - 1 hours);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(AarkaSeries.RoundIdOverflow.selector);
        series.settle(type(uint80).max);
    }

    /// @dev A successor round that exists but is after expiry is fine; that is the normal case.
    function test_acceptsWhenTheSuccessorRoundIsAfterExpiry() public {
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);
        series.settle(200);
        assertEq(series.settlementPrice(), 250e8);
    }

    /// @dev A series with no sequencer feed skips the check rather than bricking. This is the
    ///      configuration Aarka ships in until Chainlink publishes one for Robinhood Chain.
    function test_seriesWithNoSequencerFeedSkipsTheCheck() public {
        AarkaSeries s = new AarkaSeries(
            nvda, AggregatorV3Interface(address(feed)), AggregatorV3Interface(address(0)), STRIKE, EXPIRY
        );
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);
        s.settle(200);
        assertTrue(s.settled());
    }

    // ---------------------------------------------------------------- factory admin

    function test_onlyOwnerCanSetTheSequencerFeed() public {
        vm.prank(bob);
        vm.expectRevert();
        factory.setSequencerFeed(AggregatorV3Interface(address(0)));
    }

    function test_onlyOwnerCanPauseCreation() public {
        vm.prank(bob);
        vm.expectRevert();
        factory.setCreationPaused(true);
    }

    function test_ownerCanClearTheSequencerFeed() public {
        vm.prank(owner);
        factory.setSequencerFeed(AggregatorV3Interface(address(0)));
        assertEq(address(factory.sequencerUptime()), address(0));
    }

    function test_seriesEnumeration() public view {
        assertEq(factory.seriesCount(), 1);
        assertEq(factory.allSeries(0), address(series));
        assertTrue(factory.isSeries(address(series)));
        assertFalse(factory.isSeries(bob));
    }

    function test_payoutsView() public {
        _settleAt(460e8);
        (uint256 fp, uint256 up) = series.payouts();
        assertEq(fp, ONE / 2);
        assertEq(up, ONE / 2);
    }

    // ---------------------------------------------------------------- late feed changes

    /// @notice A Chainlink proxy can be repointed to a new aggregator after registration. Series
    ///         creation re-checks decimals for exactly that reason: an 18-decimal price against an
    ///         8-decimal strike would make min(S, K) == K at every conceivable price.
    function test_createRejectsAFeedThatChangedDecimalsAfterRegistration() public {
        uint64 later = uint64(EXPIRY + 7 days);
        uint64[] memory d = new uint64[](1);
        d[0] = later;
        vm.prank(owner);
        calendar.addExpiries(d);

        feed.setDecimals(18); // registered as 8, now reports 18
        vm.expectRevert(AarkaFactory.UnexpectedFeedDecimals.selector);
        factory.createSeries(address(nvda), 240e8, later);
    }

    function test_createRejectsANonPositiveSpot() public {
        uint64 later = uint64(EXPIRY + 7 days);
        uint64[] memory d = new uint64[](1);
        d[0] = later;
        vm.prank(owner);
        calendar.addExpiries(d);

        feed.pushRound(999, -1, block.timestamp); // latest round is negative
        vm.expectRevert(AarkaFactory.SpotUnavailable.selector);
        factory.createSeries(address(nvda), 240e8, later);
    }

    /// @notice If nothing actually arrives, nothing is minted. The balance-delta accounting has to
    ///         refuse rather than issue halves against a deposit that never landed.
    function test_mintRefusesADepositThatNeverArrives() public {
        BlackHoleToken hole = new BlackHoleToken("Hole", "HOLE");
        MockAggregator hf = new MockAggregator();
        hf.pushRound(1, 100e8, block.timestamp);

        uint64 later = uint64(EXPIRY + 7 days);
        uint64[] memory d = new uint64[](1);
        d[0] = later;
        vm.startPrank(owner);
        calendar.addExpiries(d);
        factory.registerAsset(address(hole), AggregatorV3Interface(address(hf)));
        vm.stopPrank();

        AarkaSeries s = AarkaSeries(factory.createSeries(address(hole), 100e8, later));
        hole.mint(alice, 100e18);
        vm.startPrank(alice);
        hole.approve(address(s), type(uint256).max);
        vm.expectRevert(AarkaSeries.ZeroAmount.selector);
        s.mint(10e18, alice);
        vm.stopPrank();
    }
}
