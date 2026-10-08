// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {MainnetBase} from "./MainnetBase.t.sol";
import {BrokenFeed} from "./StandIns.sol";
import {AarkaSeries} from "../../../src/AarkaSeries.sol";
import {AarkaLens} from "../../../src/AarkaLens.sol";
import {AarkaSequencerFeed} from "../../../src/adapters/AarkaSequencerFeed.sol";
import {AggregatorV3Interface} from "../../../src/interfaces/IExternal.sol";

/// @notice AarkaLens and the stopgap sequencer feed, on real mainnet series.
contract MainnetPeripheryTest is MainnetBase {
    address constant USDG_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;

    AarkaSeries nv230;
    AarkaSeries nv250;
    AarkaSeries ts400;

    function setUp() public {
        _forkA();
        nv230 = _create(NVDA, 230e8);
        nv250 = _create(NVDA, 250e8);
        ts400 = _create(TSLA, 400e8);
        _mintPair(nv230, alice, 6e18);
        _mintPair(ts400, alice, 2e18);
    }

    // ------------------------------------------------------------------ AarkaLens: series

    function test_lensListsAndPagesSeries() public view {
        assertEq(lens.seriesCount(), 3);
        AarkaLens.SeriesView[] memory all = lens.allSeries();
        assertEq(all.length, 3);
        assertEq(all[0].series, address(nv230));
        assertEq(all[0].underlyingSymbol, "NVDA");
        assertEq(all[0].floorSymbol, "fNVDA-230-02OCT26");
        assertEq(all[0].totalDeposited, 6e18);
        assertEq(all[0].halfSupply, 6e18);
        assertTrue(all[0].priceValid);
        assertEq(all[0].spotPrice, _spot(NVDA_FEED), "the live Chainlink answer");
        assertFalse(all[0].oraclePaused);
        assertEq(uint8(all[0].status), uint8(AarkaLens.Status.Open));

        assertEq(lens.seriesPage(1, 1).length, 1);
        assertEq(lens.seriesPage(1, 1)[0].series, address(nv250));
        assertEq(lens.seriesPage(2, 10).length, 1, "a page past the end is clamped");
        assertEq(lens.seriesPage(3, 10).length, 0, "an offset past the end is empty");

        AarkaLens.SeriesView[] memory nvda = lens.seriesByUnderlying(NVDA);
        assertEq(nvda.length, 2);
        assertEq(lens.seriesByUnderlying(TSLA)[0].series, address(ts400));
        assertEq(lens.seriesByUnderlying(USDG).length, 0);
    }

    function test_lensPositions() public view {
        AarkaLens.PositionView[] memory ps = lens.positionsOf(alice);
        assertEq(ps.length, 3);
        assertEq(ps[0].floorBalance, 6e18);
        assertEq(ps[0].redeemable, 6e18);
        assertEq(ps[0].floorClaimable, 0, "nothing claimable before settlement");
        assertEq(lens.positionsPage(alice, 2, 5).length, 1);
        assertEq(lens.positionsPage(alice, 2, 5)[0].upsideBalance, 2e18);
        assertEq(lens.positionsPage(alice, 9, 5).length, 0);
        assertEq(lens.positionsPage(alice, 0, 2).length, 2);
    }

    function test_lensRedeemableIsTheSmallerLeg() public {
        IERC20 floor = IERC20(address(nv230.floorToken()));
        IERC20 upside = IERC20(address(nv230.upsideToken()));
        vm.prank(alice);
        upside.transfer(bob, 4e18);
        assertEq(lens.positionIn(alice, address(nv230)).redeemable, 2e18);
        vm.prank(alice);
        floor.transfer(bob, 5e18);
        assertEq(lens.positionIn(alice, address(nv230)).redeemable, 1e18);
    }

    function test_lensPayoutCurveMatchesTheContract() public view {
        (uint256 f0, uint256 u0) = lens.payoutsAt(address(nv230), 0);
        assertEq(f0 + u0, 0);
        (uint256 f1, uint256 u1) = lens.payoutsAt(address(nv230), 200e8);
        assertEq(f1, 1e18, "below the line the floor is the whole share");
        assertEq(u1, 0);
        (uint256 f2, uint256 u2) = lens.payoutsAt(address(nv230), NVDA_CLOSE_PRICE);
        assertEq(f2 + u2, 1e18);
        assertEq(f2, 230e8 * 1e18 / NVDA_CLOSE_PRICE);
    }

    function test_lensStatusesThroughTheWeek() public {
        vm.warp(CLOSE_2OCT);
        assertEq(uint8(lens.view_(address(nv230)).status), uint8(AarkaLens.Status.Expired));
        _toBlockB();
        _sequencerUpPastGrace();
        nv230.settle(NVDA_CLOSE_ROUND);
        AarkaLens.SeriesView memory v = lens.view_(address(nv230));
        assertEq(uint8(v.status), uint8(AarkaLens.Status.Challenging));
        assertTrue(v.settled);
        assertEq(v.settlementPrice, NVDA_CLOSE_PRICE);
        vm.warp(v.claimsUnlockAt);
        assertEq(uint8(lens.view_(address(nv230)).status), uint8(AarkaLens.Status.Claimable));
        AarkaLens.PositionView memory p = lens.positionIn(alice, address(nv230));
        assertApproxEqAbs(p.floorClaimable + p.upsideClaimable, 6e18, 1, "6 shares, less at most a wei");
        assertLe(p.floorClaimable + p.upsideClaimable, 6e18);
    }

    /// @dev The issuer's real oracle pause shows on the card.
    function test_lensShowsARealOraclePause() public {
        vm.prank(ISSUER_ORACLE_PAUSER);
        IStock(NVDA).pauseOracle();
        assertTrue(lens.view_(address(nv230)).oraclePaused);
    }

    /// @dev USDG has no oraclePaused at all; the lens reads that as "not paused", not as an error.
    function test_lensOnATokenWithoutThePauseSignal() public {
        vm.prank(owner);
        factory.registerAsset(USDG, AggregatorV3Interface(USDG_FEED));
        AarkaSeries s = AarkaSeries(factory.createSeries(USDG, 1e8, CLOSE_2OCT));
        AarkaLens.SeriesView memory v = lens.view_(address(s));
        assertFalse(v.oraclePaused);
        assertTrue(v.priceValid);
    }

    /// @dev Stand-ins: a feed that later reverts, a feed that later answers zero, and a token whose
    ///      symbol stops resolving (the real stock tokens sit behind an upgradeable beacon). The page
    ///      still loads, with those fields zeroed.
    function test_lensSurvivesABrokenFeedAndAnOddToken() public {
        BrokenFeed f = new BrokenFeed();
        f.push(1, 100e8, block.timestamp);
        ToggleToken t = new ToggleToken();
        vm.prank(owner);
        factory.registerAsset(address(t), AggregatorV3Interface(address(f)));
        AarkaSeries s = AarkaSeries(factory.createSeries(address(t), 100e8, CLOSE_2OCT));

        f.setRevertLatest(true);
        AarkaLens.SeriesView memory v = lens.view_(address(s));
        assertFalse(v.priceValid);
        assertEq(v.spotPrice, 0);

        f.setRevertLatest(false);
        f.push(2, 0, block.timestamp);
        assertFalse(lens.view_(address(s)).priceValid, "a zero answer is not a price");

        t.breakSymbol();
        v = lens.view_(address(s));
        assertEq(v.underlyingSymbol, "");
        assertEq(v.floorSymbol, "fODD-100-02OCT26", "its own halves still read");
        assertEq(lens.allSeries().length, 4, "and the whole list still loads");
    }

    // ------------------------------------------------------------------ AarkaSequencerFeed

    function test_sequencerFeedReportsLikeChainlink() public {
        AarkaSequencerFeed feed = new AarkaSequencerFeed(owner, reporter);
        assertEq(feed.decimals(), 0);
        assertEq(feed.description(), "L2 Sequencer Uptime Status Feed (Aarka stopgap)");

        // Never reported: down, with no start time, and no fresh data.
        (uint80 id, int256 answer, uint256 startedAt,,) = feed.latestRoundData();
        assertEq(id, 0);
        assertEq(answer, 1);
        assertEq(startedAt, 0);
        assertFalse(feed.isFresh());
        vm.expectRevert(AarkaSequencerFeed.NoDataPresent.selector);
        feed.getRoundData(1);

        vm.expectRevert(AarkaSequencerFeed.NotReporter.selector);
        feed.report(true);

        uint256 t0 = block.timestamp;
        vm.prank(reporter);
        assertEq(feed.report(true), 1);
        assertTrue(feed.isFresh());

        // Same status, still fresh: the round is refreshed, its start time kept.
        vm.warp(t0 + 30 minutes);
        vm.prank(reporter);
        assertEq(feed.report(true), 1);
        (,, startedAt,,) = feed.latestRoundData();
        assertEq(startedAt, t0);

        // A change of status opens a round.
        vm.prank(reporter);
        assertEq(feed.report(false), 2);
        (, answer,,,) = feed.latestRoundData();
        assertEq(answer, 1);

        // Silence past the limit reads as down, dated from the last confirmation.
        vm.prank(reporter);
        feed.report(true); // round 3, up
        uint256 lastSeen = block.timestamp;
        vm.warp(lastSeen + 101 minutes);
        (, answer, startedAt,,) = feed.latestRoundData();
        assertEq(answer, 1);
        assertEq(startedAt, lastSeen);
        assertFalse(feed.isFresh());

        // The first report after the gap opens a new round even though the status is unchanged,
        // so a consumer's grace period starts now (AUDIT-26).
        vm.prank(reporter);
        assertEq(feed.report(true), 4);
        (,, startedAt,,) = feed.latestRoundData();
        assertEq(startedAt, block.timestamp);

        // History is history.
        (uint80 r,,,,) = feed.getRoundData(2);
        assertEq(r, 2);
    }

    function test_sequencerReporterRotation() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        sequencer.setReporter(alice);

        vm.prank(owner);
        sequencer.setReporter(bob);
        vm.expectRevert(AarkaSequencerFeed.NotReporter.selector);
        vm.prank(reporter);
        sequencer.report(true);
        vm.prank(bob);
        sequencer.report(true);
    }
}

/// @notice Stand-in: a token whose symbol can stop resolving, as an upgraded implementation might.
contract ToggleToken is ERC20 {
    bool broken;

    constructor() ERC20("Odd", "ODD") {}

    function breakSymbol() external {
        broken = true;
    }

    function symbol() public view override returns (string memory) {
        if (broken) revert("gone");
        return super.symbol();
    }
}

interface IStock {
    function pauseOracle() external;
}
