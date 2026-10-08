// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {MainnetBase} from "./MainnetBase.t.sol";
import {AarkaSeries} from "../../../src/AarkaSeries.sol";
import {AarkaLens} from "../../../src/AarkaLens.sol";
import {AarkaParityHook} from "../../../src/hook/AarkaParityHook.sol";

/// @notice The product, start to finish, on real Robinhood Chain mainnet.
///
///         28 Sep: series created through the factory on real NVDA and TSLA. Users split, sell
///         halves through the router and trade the hooked pools; a $50k trade knocks the halves
///         off parity and the hook restores it against the live $9.9m NVDA/USDG pool.
///
///         8 Oct: the series are settled against the rounds Chainlink actually published for the
///         2 Oct close, and every holder collects real stock.
contract MainnetLifecycleTest is MainnetBase {
    function setUp() public {
        _forkA();
    }

    // ------------------------------------------------------------------ the chain itself

    /// @notice What Aarka assumes about mainnet, read from mainnet.
    function test_realChainMatchesEveryAssumption() public view {
        assertEq(IERC20Metadata(USDG).decimals(), 6, "USDG");
        assertEq(IERC20Metadata(NVDA).decimals(), 18, "NVDA");
        assertEq(IERC20Metadata(TSLA).decimals(), 18, "TSLA");
        assertEq(IERC20Metadata(NVDA).symbol(), "NVDA");
        assertEq(IERC20Metadata(TSLA).symbol(), "TSLA");
        assertEq(IERC20Metadata(USDG).symbol(), "USDG");
        assertEq(IFeed(NVDA_FEED).decimals(), 8);
        assertEq(IFeed(TSLA_FEED).decimals(), 8);
        assertEq(IFeed(NVDA_FEED).description(), "RHNVDA / USD");
        assertEq(IFeed(TSLA_FEED).description(), "RHTSLA / USD");

        // The hook arbitrages the halves against the live hookless pool, so that pool must price
        // the token the way Chainlink does. Measured: within 1% for both, at both blocks.
        uint256 nvdaPool = _poolPrice(_livePool(NVDA), NVDA);
        uint256 tslaPool = _poolPrice(_livePool(TSLA), TSLA);
        assertApproxEqRel(nvdaPool * 100, _spot(NVDA_FEED), 0.01e18, "NVDA pool vs Chainlink");
        assertApproxEqRel(tslaPool * 100, _spot(TSLA_FEED), 0.01e18, "TSLA pool vs Chainlink");
        console.log("NVDA: pool $%s, Chainlink $%s (8dp)", nvdaPool, _spot(NVDA_FEED));
        console.log("TSLA: pool $%s, Chainlink $%s (8dp)", tslaPool, _spot(TSLA_FEED));
    }

    // ------------------------------------------------------------------ the whole week

    AarkaSeries nv;
    AarkaSeries tsLow;
    AarkaSeries tsHigh;
    Market m;

    function test_aWeekOnMainnet_createTradeSettleCollect() public {
        _week1_createAndSplit();
        _week1_marketAndRouter();
        _week1_parity();
        _week2_settle();
        _week2_collect();
    }

    /// @dev 28 Sep: create through the factory, on the real tokens and feeds.
    function _week1_createAndSplit() internal {
        nv = _create(NVDA, 230e8);
        tsLow = _create(TSLA, 350e8);
        tsHigh = _create(TSLA, 400e8);
        assertEq(nv.floorToken().symbol(), "fNVDA-230-02OCT26");
        assertEq(nv.upsideToken().symbol(), "uNVDA-230-02OCT26");
        assertEq(nv.floorToken().name(), "Aarka Floor NVDA 02OCT26 $230.00");
        assertEq(tsHigh.upsideToken().symbol(), "uTSLA-400-02OCT26");
        assertTrue(nv.hasOraclePause(), "the real token exposes oraclePaused");
        assertEq(address(nv.sequencerUptime()), address(sequencer));

        // Alice splits 10 NVDA and keeps both halves.
        _mintPair(nv, alice, 10e18);
        assertEq(IERC20(NVDA).balanceOf(address(nv)), 10e18);
    }

    /// @dev The NVDA market: hooked floor and upside pools beside the live NVDA/USDG pool.
    function _week1_marketAndRouter() internal {
        m = _openMarket(nv, 9_500, 2_000e18, 1_000e18);
        assertLt(_gapBps(m), 5, "opened at parity");

        // Bob keeps the floor and sells the upside, one transaction.
        _fund(bob, 5e18, 0, 0);
        _approveRouter(bob);
        vm.prank(bob);
        uint256 cash = router.splitAndSell(nv, true, 5e18, m.upsideKey, 1, bob);
        assertEq(m.floor.balanceOf(bob), 5e18, "bob keeps 5 floors");
        assertGt(IERC20(USDG).balanceOf(bob), 0, "and is paid in real USDG");
        console.log("bob sold 5 upsides for %s USDG (6dp)", cash);
    }

    /// @dev A $50k floor buy knocks the halves off parity. The hook buys real NVDA from the live
    ///      pool, splits it at the vault and sells both halves, inside the same transaction.
    function _week1_parity() internal {
        _fund(trader, 0, 0, 50_000e6);
        _approveRouter(trader);
        uint256 vaultBefore = IERC20(NVDA).balanceOf(address(nv));
        vm.recordLogs();
        _sell(trader, m.floorKey, USDG, 50_000e6);
        (bool restored, uint256 size, uint256 profit) = _parityEvent(address(m.hook));
        assertTrue(restored, "the hook acted");
        assertGt(size, 0);
        assertGt(profit, 0, "and paid the LPs");
        assertLt(_gapBps(m), m.hook.minDeviationBps(), "parity back inside the threshold");
        assertEq(IERC20(NVDA).balanceOf(address(nv)), vaultBefore + size, "every share it bought was split at the vault");
        console.log("hook split %s NVDA-wei and paid LPs %s USDG-wei", size, profit);
        console.log("gap after: %s bps", _gapBps(m));
    }

    /// @dev 8 Oct: the real closing rounds are on chain.
    function _week2_settle() internal {
        _toBlockB(_marketAddrs(m));
        assertGt(block.timestamp, CLOSE_2OCT);
        _sequencerUpPastGrace();

        nv.settle(NVDA_CLOSE_ROUND);
        tsLow.settle(TSLA_CLOSE_ROUND);
        tsHigh.settle(TSLA_CLOSE_ROUND);
        assertEq(nv.settlementPrice(), NVDA_CLOSE_PRICE, "NVDA settled at Chainlink's 2 Oct close");
        assertEq(tsLow.settlementPrice(), TSLA_CLOSE_PRICE, "TSLA too");
        assertEq(nv.floorPayoutPerUnit(), Math.mulDiv(230e8, 1e18, NVDA_CLOSE_PRICE));
        assertEq(nv.floorPayoutPerUnit() + nv.upsidePayoutPerUnit(), 1e18);
        assertEq(tsHigh.floorPayoutPerUnit(), 1e18, "TSLA closed under $400: the floor takes the whole share");
        assertEq(tsHigh.upsidePayoutPerUnit(), 0);
        assertFalse(nv.settledLate());
        assertEq(uint8(lens.view_(address(nv)).status), uint8(AarkaLens.Status.Challenging));

        vm.expectRevert(AarkaSeries.ClaimsLocked.selector);
        vm.prank(alice);
        nv.claimFloor(1, alice);
    }

    function _week2_collect() internal {
        vm.warp(block.timestamp + nv.CHALLENGE_PERIOD());
        assertEq(uint8(lens.view_(address(nv)).status), uint8(AarkaLens.Status.Claimable));

        // Alice collects both legs: 10 NVDA between them, less at most a wei of rounding.
        AarkaLens.PositionView memory p = lens.positionIn(alice, address(nv));
        vm.startPrank(alice);
        uint256 a = nv.claimFloor(10e18, alice);
        uint256 b = nv.claimUpside(10e18, alice);
        vm.stopPrank();
        assertEq(a, p.floorClaimable, "the lens quoted exactly what was paid");
        assertEq(b, p.upsideClaimable);
        assertApproxEqAbs(a + b, 10e18, 1, "a pair is one share");
        assertLe(a + b, 10e18, "and never more");
        console.log("alice: floor paid %s, upside paid %s NVDA-wei", a, b);

        // Every floor and upside still outstanding can be paid from what the vault holds.
        uint256 owed = Math.mulDiv(m.floor.totalSupply(), nv.floorPayoutPerUnit(), 1e18)
            + Math.mulDiv(m.upside.totalSupply(), nv.upsidePayoutPerUnit(), 1e18);
        assertLe(owed, IERC20(NVDA).balanceOf(address(nv)), "the vault is solvent");
    }

    // ------------------------------------------------------------------ helpers

    function _parityEvent(address hook) internal returns (bool found, uint256 size, uint256 profit) {
        bytes32 topic = AarkaParityHook.ParityRestored.selector;
        VmLog[] memory logs = _logs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == hook && logs[i].topics[0] == topic) {
                (, size, profit) = abi.decode(logs[i].data, (bool, uint256, uint256));
                return (true, size, profit);
            }
        }
    }

    struct VmLog {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function _logs() internal returns (VmLog[] memory out) {
        bytes memory raw = abi.encode(vm.getRecordedLogs());
        out = abi.decode(raw, (VmLog[]));
    }
}

interface IERC20Metadata {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

interface IFeed {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
}
