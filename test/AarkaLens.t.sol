// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./Base.t.sol";
import {AarkaLens} from "../src/AarkaLens.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {PlainToken} from "./mocks/MockStockToken.sol";

contract AarkaLensTest is BaseTest {
    AarkaLens lens;
    uint64 constant EXPIRY2 = 1_790_971_200; // Fri 02 Oct 2026

    function setUp() public override {
        super.setUp();
        lens = new AarkaLens(factory);
    }

    function _addExpiry(uint64 t) internal {
        uint64[] memory d = new uint64[](1);
        d[0] = t;
        vm.prank(owner);
        calendar.addExpiries(d);
    }

    // ---------------------------------------------------------------- series views

    function test_oneCallRendersTheWholeSeries() public view {
        AarkaLens.SeriesView[] memory all = lens.allSeries();
        assertEq(all.length, 1);
        AarkaLens.SeriesView memory v = all[0];

        assertEq(v.series, address(series));
        assertEq(v.underlying, address(nvda));
        assertEq(v.underlyingSymbol, "NVDA");
        assertEq(v.strike, STRIKE);
        assertEq(v.expiry, EXPIRY);
        assertEq(v.floorSymbol, "fNVDA-230-25SEP26");
        assertEq(v.upsideSymbol, "uNVDA-230-25SEP26");
        assertEq(v.spotPrice, 215e8);
        assertTrue(v.priceValid);
        assertFalse(v.oraclePaused);
        assertFalse(v.settled);
        assertEq(uint8(v.status), uint8(AarkaLens.Status.Open));
    }

    function test_statusTracksTheLifecycle() public {
        assertEq(uint8(lens.view_(address(series)).status), uint8(AarkaLens.Status.Open));

        vm.warp(EXPIRY + 1);
        assertEq(uint8(lens.view_(address(series)).status), uint8(AarkaLens.Status.Expired));

        _publishSettlementRounds(250e8);
        series.settle(200);
        assertEq(uint8(lens.view_(address(series)).status), uint8(AarkaLens.Status.Challenging));

        vm.warp(block.timestamp + series.CHALLENGE_PERIOD());
        assertEq(uint8(lens.view_(address(series)).status), uint8(AarkaLens.Status.Claimable));
    }

    function test_sizeFieldsTrackDeposits() public {
        vm.prank(alice);
        series.mint(70e18, alice);
        AarkaLens.SeriesView memory v = lens.view_(address(series));
        assertEq(v.totalDeposited, 70e18);
        assertEq(v.halfSupply, 70e18);
    }

    function test_filterByUnderlying() public {
        PlainToken other = new PlainToken("Other", "OTHER");
        MockAggregator of_ = new MockAggregator();
        of_.pushRound(1, 50e8, NOW - 60);
        _addExpiry(EXPIRY2);
        vm.prank(owner);
        factory.registerAsset(address(other), AggregatorV3Interface(address(of_)));
        factory.createSeries(address(other), 50e8, EXPIRY2);

        assertEq(lens.allSeries().length, 2);
        assertEq(lens.seriesByUnderlying(address(nvda)).length, 1);
        assertEq(lens.seriesByUnderlying(address(other)).length, 1);
        assertEq(lens.seriesByUnderlying(address(0xdead)).length, 0);
    }

    function test_pagination() public {
        _addExpiry(EXPIRY2);
        factory.createSeries(address(nvda), 240e8, EXPIRY2);
        assertEq(lens.seriesPage(0, 1).length, 1);
        assertEq(lens.seriesPage(1, 10).length, 1);
        assertEq(lens.seriesPage(5, 10).length, 0, "offset past the end returns empty, not a revert");
    }

    // ---------------------------------------------------------------- positions

    function test_positionShowsWhatTheHolderCanDo() public {
        vm.prank(alice);
        series.mint(100e18, alice);
        vm.prank(alice);
        u.transfer(bob, 40e18);

        AarkaLens.PositionView memory a = lens.positionIn(alice, address(series));
        assertEq(a.floorBalance, 100e18);
        assertEq(a.upsideBalance, 60e18);
        assertEq(a.redeemable, 60e18, "redeem needs pairs, so it is the smaller leg");
        assertEq(a.underlyingBalance, 900e18);
        assertEq(a.underlyingAllowance, type(uint256).max);

        AarkaLens.PositionView memory b = lens.positionIn(bob, address(series));
        assertEq(b.floorBalance, 0);
        assertEq(b.upsideBalance, 40e18);
        assertEq(b.redeemable, 0, "one leg alone cannot be redeemed");
    }

    function test_claimableAppearsOnlyAfterSettlement() public {
        vm.prank(alice);
        series.mint(100e18, alice);

        assertEq(lens.positionIn(alice, address(series)).floorClaimable, 0);

        _settleAt(460e8); // S = 2K
        AarkaLens.PositionView memory p = lens.positionIn(alice, address(series));
        assertEq(p.floorClaimable, 50e18);
        assertEq(p.upsideClaimable, 50e18);
    }

    function test_positionsAcrossEverySeries() public {
        _addExpiry(EXPIRY2);
        AarkaSeries s2 = AarkaSeries(factory.createSeries(address(nvda), 240e8, EXPIRY2));
        vm.startPrank(alice);
        series.mint(10e18, alice);
        nvda.approve(address(s2), type(uint256).max);
        s2.mint(20e18, alice);
        vm.stopPrank();

        AarkaLens.PositionView[] memory ps = lens.positionsOf(alice);
        assertEq(ps.length, 2);
        assertEq(ps[0].floorBalance, 10e18);
        assertEq(ps[1].floorBalance, 20e18);
    }

    // ---------------------------------------------------------------- quotes

    /// @notice The payoff curve must come from the contract, not a TypeScript reimplementation
    ///         that can drift away from settlement.
    function test_payoutQuoteMatchesRealSettlement() public {
        uint256 price = 391e8;
        (uint256 qf, uint256 qu) = lens.payoutsAt(address(series), price);
        assertEq(qf + qu, 1e18);

        _settleAt(int256(price));
        assertEq(qf, series.floorPayoutPerUnit(), "quote must equal what settlement computed");
        assertEq(qu, series.upsidePayoutPerUnit());
    }

    function testFuzz_quoteAlwaysConserves(uint256 price) public view {
        price = bound(price, 1, 1e18);
        (uint256 qf, uint256 qu) = lens.payoutsAt(address(series), price);
        assertEq(qf + qu, 1e18);
    }

    // ---------------------------------------------------------------- resilience

    /// @notice A broken feed must degrade one field, not take the page down.
    function test_deadFeedDoesNotRevertTheBatch() public {
        feed.pushRound(300, 0, 0); // latest round is now junk
        AarkaLens.SeriesView memory v = lens.view_(address(series));
        assertFalse(v.priceValid);
        assertEq(v.spotPrice, 0);
        assertEq(v.strike, STRIKE, "the rest of the view is still filled in");
    }

    function test_tokenWithoutOptionalInterfacesStillRenders() public {
        PlainToken other = new PlainToken("Other", "OTHER");
        MockAggregator of_ = new MockAggregator();
        of_.pushRound(1, 50e8, NOW - 60);
        _addExpiry(EXPIRY2);
        vm.prank(owner);
        factory.registerAsset(address(other), AggregatorV3Interface(address(of_)));
        address s = factory.createSeries(address(other), 50e8, EXPIRY2);

        AarkaLens.SeriesView memory v = lens.view_(s);
        assertFalse(v.oraclePaused, "no oraclePaused() must read as not paused, not revert");
        assertEq(v.underlyingSymbol, "OTHER");
    }

    function test_oraclePausedIsSurfaced() public {
        nvda.setOraclePaused(true);
        assertTrue(lens.view_(address(series)).oraclePaused);
    }

    /// @notice AUDIT-19. The bounded read the site now uses instead of positionsOf.
    function test_positionsPageMatchesTheUnboundedRead() public {
        vm.prank(alice);
        series.mint(10e18, alice);
        AarkaLens.PositionView[] memory all = lens.positionsOf(alice);
        AarkaLens.PositionView[] memory page = lens.positionsPage(alice, 0, 50);
        assertEq(page.length, all.length);
        assertEq(page[0].floorBalance, all[0].floorBalance);
        assertEq(page[0].series, all[0].series);
        assertEq(lens.positionsPage(alice, all.length, 10).length, 0, "past the end is empty, not a revert");
        assertEq(lens.positionsPage(alice, 0, 1).length, 1);
    }
}
