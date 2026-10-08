// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console, Vm} from "forge-std/Test.sol";
import {HookBaseTest} from "./HookBase.t.sol";
import {AarkaParityHook} from "../../src/hook/AarkaParityHook.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";

contract AarkaParityHookTest is HookBaseTest {
    /// @dev A swap large enough to break parity well past the threshold.
    uint256 constant BIG_SWAP_QUOTE = 50_000e6;

    // ---------------------------------------------------------------- wiring and access

    function test_poolsStartAtParity() public view {
        assertLt(parityGapBps(), 10, "pools should initialise at parity");
    }

    /// @dev 0x640 is afterSwap, afterAddLiquidity and beforeRemoveLiquidity. Any other bit set
    ///      would make v4 call an entry point that reverts, so the constructor asserts this rather
    ///      than trusting the deploy script.
    function test_hookAddressCarriesExactlyItsThreeFlags() public view {
        assertEq(uint160(address(hook)) & 0x3FFF, 0x640);
        assertEq(hook.PERMISSIONS(), 0x640);
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
        hook.restoreParity(floorKey, 0);
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
        uint256 withHook = _runBigSwap(100_000e18);

        console.log("parity gap without hook (bps):", withoutHook);
        console.log("parity gap with hook    (bps):", withHook);
        assertLt(withHook, withoutHook, "the hook must reduce the parity gap");
        // The solver targets the root, not a fixed fraction of it, so the residual is dust.
        assertLe(withHook, 5, "solved size should close parity to within a handful of bps");
        assertGt(withoutHook, 500, "the control must actually be badly mispriced");
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
        uint256 withHook = _runBigSell(100_000e18);
        console.log("sell-side gap without hook (bps):", withoutHook);
        console.log("sell-side gap with hook    (bps):", withHook);
        assertLe(withHook, 5, "the redeem direction must close parity too");
        assertGt(withoutHook, 500);
    }

    /// @notice The solver must respect maxArbSize as a hard ceiling, so an operator can still
    ///         bound the hook's exposure regardless of what the maths wants.
    function test_solverRespectsTheHardCap() public {
        uint256 capped = _runBigSwap(1e18); // one token: far below the parity-restoring size
        uint256 uncapped = _runBigSwap(100_000e18);
        console.log("gap with a 1-token cap (bps):", capped);
        console.log("gap uncapped           (bps):", uncapped);
        assertGt(capped, uncapped, "a tight cap must limit how much parity is restored");
        assertGt(capped, 500, "one token cannot move a 633 bps gap");
    }

    /// @notice Sizing must adapt to the gap rather than being a constant. A gap twice as large
    ///         should draw a materially larger trade.
    function test_sizeScalesWithTheMispricing() public {
        setUp();
        vm.recordLogs();
        _buyFloor(20_000e6);
        uint256 smallProfit = _lastProfit();

        setUp();
        vm.recordLogs();
        _buyFloor(80_000e6);
        uint256 largeProfit = _lastProfit();

        console.log("profit on a small dislocation:", smallProfit);
        console.log("profit on a large dislocation:", largeProfit);
        assertGt(largeProfit, smallProfit, "a wider gap must yield a larger captured profit");
    }

    function _lastProfit() internal returns (uint256 profit) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == AarkaParityHook.ParityRestored.selector) {
                (,, profit) = abi.decode(logs[i].data, (bool, uint256, uint256));
            }
        }
    }

    /// @notice Turning the hook off is a clean no-op, not a revert.

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

    // ---------------------------------------------------------------- unused entry points

    /// @notice Every hook entry point the address does not enable must revert, not no-op.
    /// @dev v4 derives permissions from the low 14 bits of the hook address. If a future deploy
    ///      mis-mines the salt and enables an extra flag, v4 will call one of these. Reverting
    ///      makes that fail loudly at the first swap instead of silently changing pool behaviour.
    function test_unusedEntryPointsRevert() public {
        IPoolManager.ModifyLiquidityParams memory mp =
            IPoolManager.ModifyLiquidityParams({tickLower: 0, tickUpper: 60, liquidityDelta: 0, salt: 0});
        IPoolManager.SwapParams memory sp =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 0});
        BalanceDelta zero = BalanceDelta.wrap(0);
        bytes4 err = AarkaParityHook.HookNotImplemented.selector;

        vm.expectRevert(err);
        hook.beforeInitialize(address(this), floorKey, 0);
        vm.expectRevert(err);
        hook.afterInitialize(address(this), floorKey, 0, 0);
        vm.expectRevert(err);
        hook.beforeAddLiquidity(address(this), floorKey, mp, "");
        vm.expectRevert(err);
        hook.afterRemoveLiquidity(address(this), floorKey, mp, zero, zero, "");
        vm.expectRevert(err);
        hook.beforeSwap(address(this), floorKey, sp, "");
        vm.expectRevert(err);
        hook.beforeDonate(address(this), floorKey, 0, 0, "");
        vm.expectRevert(err);
        hook.afterDonate(address(this), floorKey, 0, 0, "");
    }

    /// @notice setParams is the only tunable surface and it is owner-only.
    function test_onlyOwnerCanSetParams() public {
        vm.prank(trader);
        vm.expectRevert();
        hook.setParams(50, 1e18);

        vm.prank(owner);
        hook.setParams(50, 1e18);
        assertEq(hook.minDeviationBps(), 50);
        assertEq(hook.maxArbSize(), 1e18);
    }

    // ---------------------------------------------------------------- solver edge cases

    /// @notice The constructor assertion that protects the entire permission model. v4 reads a
    ///         hook's permissions from its address, so a hook deployed to an unmined address would
    ///         silently have the wrong permissions. Deploying plainly must fail loudly.
    function test_deployingToAnUnminedAddressReverts() public {
        vm.expectRevert(AarkaParityHook.InvalidHookAddress.selector);
        new AarkaParityHook(
            IPoolManager(address(manager)), series, Currency.wrap(address(usdg)), owner
        );
    }

    /// @notice A pool with no liquidity has no price to solve against, so the arb must decline
    ///         rather than divide by zero.
    function test_solverDeclinesWhenAPoolIsEmpty() public {
        // A second hook, wired to pools that name it: a liquid floor pool, and an upside pool that
        // is initialised but holds nothing, so any arb it sizes has nowhere to trade.
        AarkaParityHook fresh = _mineAndDeploy();
        PoolKey memory fFresh = _key(address(f), address(usdg), IHooks(address(fresh)));
        PoolKey memory uEmpty = _key(address(u), address(usdg), IHooks(address(fresh)));
        manager.initialize(fFresh, _sqrtPrice(fFresh, address(f), P_FLOOR));
        manager.initialize(uEmpty, _sqrtPrice(uEmpty, address(u), P_UPSIDE));
        vm.prank(lp);
        _addLiquidity(fFresh);

        vm.startPrank(owner);
        fresh.wire(underlyingKey, fFresh, uEmpty);
        fresh.setParams(1, 100_000e18);
        vm.stopPrank();

        uint256 before = f.balanceOf(trader);
        _swap(fFresh, !_assetIsZero(fFresh, address(f)), -int256(uint256(10_000e6)));
        assertGt(f.balanceOf(trader), before, "the swap fills; the hook simply declines");
    }

    /// @notice The two halves' pools must name this hook, or their swaps would never reach it.
    function test_wiringRejectsAPoolThatDoesNotCarryTheHook() public {
        AarkaParityHook fresh = _mineAndDeploy();
        vm.prank(owner);
        vm.expectRevert(AarkaParityHook.PoolMismatch.selector);
        fresh.wire(underlyingKey, floorKey, upsideKey); // these name the other hook
    }

    /// @notice An uninitialised pool prices at zero; wiring one would break every later arb.
    function test_wiringRejectsAnUninitialisedPool() public {
        AarkaParityHook fresh = _mineAndDeploy();
        PoolKey memory fFresh = _key(address(f), address(usdg), IHooks(address(fresh)));
        PoolKey memory uFresh = _key(address(u), address(usdg), IHooks(address(fresh)));
        manager.initialize(fFresh, _sqrtPrice(fFresh, address(f), P_FLOOR));
        vm.prank(owner);
        vm.expectRevert(AarkaParityHook.PoolNotInitialised.selector);
        fresh.wire(underlyingKey, fFresh, uFresh);
    }

    /// @notice Only the PoolManager can drive the liquidity callbacks, so nobody can reset a
    ///         position's clock or read the gate as open by calling them directly.
    function test_liquidityCallbacksAreManagerOnly() public {
        IPoolManager.ModifyLiquidityParams memory mp =
            IPoolManager.ModifyLiquidityParams({tickLower: 0, tickUpper: 60, liquidityDelta: 0, salt: 0});
        BalanceDelta zero = BalanceDelta.wrap(0);
        vm.expectRevert(AarkaParityHook.NotPoolManager.selector);
        hook.afterAddLiquidity(address(this), floorKey, mp, zero, zero, "");
        vm.expectRevert(AarkaParityHook.NotPoolManager.selector);
        hook.beforeRemoveLiquidity(address(this), floorKey, mp, "");
    }

    /// @notice Below the deviation threshold the hook must decline before doing any work at all.
    function test_hookDeclinesWhenAlreadyAtParity() public {
        vm.prank(owner);
        hook.setParams(5000, 100_000e18); // threshold far above any real dislocation
        uint256 before = f.balanceOf(trader);
        _buyFloor(BIG_SWAP_QUOTE);
        assertGt(f.balanceOf(trader), before, "swap fills; the hook simply does nothing");
        assertGt(parityGapBps(), 100, "and the gap is left wide open");
    }
}
