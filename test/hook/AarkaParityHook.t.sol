// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console, Vm} from "forge-std/Test.sol";
import {HookBaseTest} from "./HookBase.t.sol";
import {AarkaParityHook} from "../../src/hook/AarkaParityHook.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

contract AarkaParityHookTest is HookBaseTest {
    /// @dev A swap large enough to break parity well past the threshold.
    uint256 constant BIG_SWAP_QUOTE = 50_000e6;

    // ---------------------------------------------------------------- wiring and access

    function test_poolsStartAtParity() public view {
        assertLt(parityGapBps(), 10, "pools should initialise at parity");
    }

    /// @dev 0x40 is AFTER_SWAP_FLAG. Any other bit set would make v4 call an entry point that
    ///      reverts, so the constructor asserts this rather than trusting the deploy script.
    function test_hookAddressCarriesOnlyTheAfterSwapFlag() public view {
        assertEq(uint160(address(hook)) & 0x3FFF, 0x40);
    }

    function test_wiringIsOneWay() public {
        vm.prank(owner);
        vm.expectRevert(AarkaParityHook.AlreadyWired.selector);
        hook.wire(underlyingKey, floorKey, upsideKey);
    }

    function test_wiringRejectsAMismatchedPool() public {
        AarkaParityHook fresh = _mineAndDeploy();
        vm.prank(owner);
        vm.expectRevert(AarkaParityHook.PoolMismatch.selector);
        fresh.wire(floorKey, underlyingKey, upsideKey); // floor pool passed as the underlying pool
    }

    function test_onlyOwnerCanWire() public {
        AarkaParityHook fresh = _mineAndDeploy();
        vm.prank(trader);
        vm.expectRevert();
        fresh.wire(underlyingKey, floorKey, upsideKey);
    }

    function test_restoreParityIsNotCallableExternally() public {
        vm.expectRevert(AarkaParityHook.NotSelf.selector);
        hook.restoreParity(floorKey);
    }

    function test_afterSwapIsOnlyCallableByThePoolManager() public {
        vm.expectRevert(AarkaParityHook.NotPoolManager.selector);
        hook.afterSwap(
            address(this),
            floorKey,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 0}),
            BalanceDelta.wrap(0),
            ""
        );
    }

    // ---------------------------------------------------------------- behaviour

    /// @notice Below the threshold the hook must cost three slot0 reads and nothing else.
    function test_smallSwapStaysUnderTheThreshold() public {
        _buyFloor(50e6);
        assertLt(parityGapBps(), hook.minDeviationBps());
    }

    /// @notice The headline behaviour, measured against a control. A large swap breaks parity;
    ///         the hook closes part of it inside the same transaction, before the swap returns.
    function test_hookClosesTheGapComparedToNoHook() public {
        uint256 withoutHook = _runBigSwap(0); // maxArbSize 0 disables the hook
        uint256 withHook = _runBigSwap(200e18);

        console.log("parity gap without hook (bps):", withoutHook);
        console.log("parity gap with hook    (bps):", withHook);
        assertLt(withHook, withoutHook, "the hook must reduce the parity gap");
    }

    /// @notice The reentrancy guard, which is what lets the arb trade the pool it was triggered
    ///         from. Without the transient flag this recurses until it runs out of gas.
    function test_hookTradesItsOwnPoolWithoutRecursing() public {
        _buyFloor(BIG_SWAP_QUOTE);
        assertGt(f.balanceOf(trader), 0);
    }

    /// @notice An unprofitable arb must never take the user's swap down with it.
    /// @dev maxArbSize is set absurdly large so the arb's own slippage swamps the gap and the
    ///      profitability check reverts. The try/catch in afterSwap has to contain that.
    function test_unprofitableArbDoesNotRevertTheUserSwap() public {
        vm.prank(owner);
        hook.setParams(1, 5_000_000e18);

        uint256 before = f.balanceOf(trader);
        _buyFloor(20_000e6);
        assertGt(f.balanceOf(trader), before, "user swap must still have filled");
    }

    /// @notice The hook holds no inventory between transactions. Everything nets inside the lock,
    ///         and the profit leaves via donate rather than accumulating here.
    function test_hookHoldsNoInventory() public {
        _buyFloor(BIG_SWAP_QUOTE);
        assertEq(nvda.balanceOf(address(hook)), 0, "no underlying left over");
        assertEq(usdg.balanceOf(address(hook)), 0, "no quote left over");
        assertEq(f.balanceOf(address(hook)), 0, "no floor tokens left over");
        assertEq(u.balanceOf(address(hook)), 0, "no upside tokens left over");
    }

    /// @notice The profit is real and strictly positive, and it leaves via donate().
    /// @dev The hook's own balances stay at zero (test_hookHoldsNoInventory), so a positive
    ///      profit in the event plus a zero balance means the value went to the LPs.
    function test_profitIsPositiveAndDonated() public {
        vm.recordLogs();
        _buyFloor(BIG_SWAP_QUOTE);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        uint256 profit;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == AarkaParityHook.ParityRestored.selector) {
                (, , profit) = abi.decode(logs[i].data, (bool, uint256, uint256));
                found = true;
            }
        }
        assertTrue(found, "hook should have fired");
        assertGt(profit, 0, "arb must be strictly profitable or it reverts");
        assertEq(usdg.balanceOf(address(hook)), 0, "profit must not stay with the hook");
    }

    /// @notice Turning the hook off is a clean no-op, not a revert.
    function test_disabledHookLeavesSwapsAlone() public {
        vm.prank(owner);
        hook.setParams(30, 0);
        uint256 before = f.balanceOf(trader);
        _buyFloor(10_000e6);
        assertGt(f.balanceOf(trader), before);
    }

    /// @notice Works in the other direction too: dumping floor tokens makes the halves cheap,
    ///         which is the redeem side of the arb.
    function test_hookHandlesTheHalvesBeingCheap() public {
        uint256 withoutHook = _runBigSell(0);
        uint256 withHook = _runBigSell(200e18);
        console.log("sell-side gap without hook (bps):", withoutHook);
        console.log("sell-side gap with hook    (bps):", withHook);
        assertLe(withHook, withoutHook);
    }

    // ---------------------------------------------------------------- helpers

    function _assetIsZero(PoolKey memory key, address asset) internal pure returns (bool) {
        return Currency.unwrap(key.currency0) == asset;
    }

    /// @dev Spend `quoteAmount` of USDG buying floor tokens, pushing P(f) up.
    function _buyFloor(uint256 quoteAmount) internal {
        _swap(floorKey, !_assetIsZero(floorKey, address(f)), -int256(quoteAmount));
    }

    /// @dev Sell `assetAmount` floor tokens, pushing P(f) down.
    function _sellFloor(uint256 assetAmount) internal {
        _swap(floorKey, _assetIsZero(floorKey, address(f)), -int256(assetAmount));
    }

    /// @dev setUp is deterministic, so re-running it gives an identical world for the control leg.
    function _runBigSwap(uint256 maxArbSize) internal returns (uint256) {
        setUp();
        vm.prank(owner);
        hook.setParams(30, maxArbSize);
        _buyFloor(BIG_SWAP_QUOTE);
        return parityGapBps();
    }

    function _runBigSell(uint256 maxArbSize) internal returns (uint256) {
        setUp();
        vm.prank(owner);
        hook.setParams(30, maxArbSize);
        _sellFloor(300e18);
        return parityGapBps();
    }
}
