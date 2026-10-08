// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MainnetBase} from "./MainnetBase.t.sol";
import {AarkaSeries} from "../../../src/AarkaSeries.sol";
import {AarkaParityHook} from "../../../src/hook/AarkaParityHook.sol";

/// @notice How the hook behaves as trades grow, against the real 0.30% NVDA/USDG pool and its
///         real concentrated liquidity. Measurement, printed; asserts only that no trade reverts.
contract MainnetHookDepthTest is MainnetBase {
    function setUp() public {
        _forkA();
    }

    function test_DEPTH_10k() public {
        _depth(10_000e6);
    }

    function test_DEPTH_50k() public {
        _depth(50_000e6);
    }

    function test_DEPTH_100k() public {
        _depth(100_000e6);
    }

    function test_DEPTH_250k() public {
        _depth(250_000e6);
    }

    function test_DEPTH_500k() public {
        _depth(500_000e6);
    }

    function test_DEPTH_1m() public {
        _depth(1_000_000e6);
    }

    /// @dev One floor buy of `usd` against a fresh market; prints what the hook did.
    function _depth(uint256 usd) internal {
        AarkaSeries s = _create(NVDA, 230e8);
        Market memory m = _openMarket(s, 9_500, 9_000e18, 100_000e18);
        _approveRouter(trader);
        _fund(trader, 0, 0, usd);
        vm.recordLogs();
        _sell(trader, m.floorKey, USDG, usd); // never reverts, whatever the hook does
        (bool acted, uint256 size, uint256 profit) = _event(address(m.hook));
        console.log("buy $%s of floors -> hook acted: %s", usd / 1e6, acted);
        console.log("    split %s NVDA, LPs paid $%s, gap after %s bps", size / 1e18, profit / 1e6, _gapBps(m));
    }

    /// @notice AUDIT-30 on the live pool. Before the fix a $1m floor buy drew no correction at
    ///         all: the arb asked the real, concentrated 0.30% NVDA pool for more stock than it
    ///         would sell, ended owing ~911 NVDA and unwound. Now it corrects with what the pool
    ///         actually sells, and the gap is narrower than the trade left it.
    function test_AUDIT30_aMillionDollarTradeStillDrawsACorrection() public {
        AarkaSeries s = _create(NVDA, 230e8);
        Market memory m = _openMarket(s, 9_500, 9_000e18, 100_000e18);
        _approveRouter(trader);
        _fund(trader, 0, 0, 1_000_000e6);

        uint256 snap = vm.snapshotState();
        vm.prank(owner);
        m.hook.setParams(100, 0);
        _sell(trader, m.floorKey, USDG, 1_000_000e6);
        uint256 gapWithoutHook = _gapBps(m);
        vm.revertToState(snap);

        vm.recordLogs();
        _sell(trader, m.floorKey, USDG, 1_000_000e6);
        (bool acted, uint256 size, uint256 profit) = _event(address(m.hook));
        assertTrue(acted, "the hook acted");
        assertGt(size, 0);
        assertGt(profit, 0);
        assertLt(_gapBps(m), gapWithoutHook, "and narrowed the gap");
        console.log("$1m: split %s NVDA, LPs paid $%s", size / 1e18, profit / 1e6);
        console.log("gap %s bps, against %s bps with no hook", _gapBps(m), gapWithoutHook);
    }

    function _event(address hook) internal returns (bool, uint256, uint256) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == hook && logs[i].topics[0] == AarkaParityHook.ParityRestored.selector) {
                (, uint256 size, uint256 profit) = abi.decode(logs[i].data, (bool, uint256, uint256));
                return (true, size, profit);
            }
        }
        return (false, 0, 0);
    }
}
