// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console, Vm} from "forge-std/Test.sol";
import {HookBaseTest} from "./HookBase.t.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";

/// @notice Economic probes against the parity hook, written for the September audit.
///
/// @dev Not security bugs in the sense of AUDIT-04: nothing here lets anyone take funds the hook
///      holds. They measure who carries the risk when the hook does exactly what it was built to do.
contract EconomicAuditTest is HookBaseTest {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    /// @notice The hook takes the unhooked underlying pool as the truth. Move that pool and the
    ///         hook moves both halves after it, trading against the half pools' LPs.
    function test_ECON01_movingTheStockPoolDragsBothHalves() public {
        uint256 fBefore = priceX96(floorKey, address(f));
        uint256 uBefore = priceX96(upsideKey, address(u));
        uint256 nBefore = priceX96(underlyingKey, address(nvda));

        // Sell NVDA into the stock pool. No hook there, so nothing reacts yet.
        _swap(underlyingKey, _isZero(underlyingKey, address(nvda)), -int256(uint256(2_000e18)));
        uint256 nMoved = priceX96(underlyingKey, address(nvda));

        // Any swap at all in a half pool, even a dollar, now hands the hook the dislocation.
        _swap(floorKey, _isZero(floorKey, address(usdg)), -int256(uint256(1e6)));

        uint256 fAfter = priceX96(floorKey, address(f));
        uint256 uAfter = priceX96(upsideKey, address(u));

        console.log("stock pool moved (bps)  :", _bps(nBefore, nMoved));
        console.log("floor pool followed (bps):", _bps(fBefore, fAfter));
        console.log("upside pool followed (bps):", _bps(uBefore, uAfter));
        console.log("parity gap after (bps)  :", parityGapBps());

        assertLt(fAfter, fBefore, "the floor price was dragged down");
        assertLt(uAfter, uBefore, "the upside price was dragged down");
    }

    /// @notice Round trip: push the stock pool down, let the hook follow, push it back, let the
    ///         hook follow again. Compare the manipulator's result with and without the hook
    ///         being triggered, valuing every token at the opening marks.
    function test_ECON02_roundTripThroughTheHook() public {
        uint256 snap = vm.snapshotState();

        int256 withHook = _roundTrip(true);
        vm.revertToState(snap);
        int256 withoutHook = _roundTrip(false);

        console.log("manipulator P&L, hook triggered (USDG):");
        console.logInt(withHook / 1e6);
        console.log("manipulator P&L, control, no trigger (USDG):");
        console.logInt(withoutHook / 1e6);
        console.log("difference the hook made (USDG):");
        console.logInt((withHook - withoutHook) / 1e6);

        // The attack does not pay. The hook's arbitrage is taken out of the manipulator's own
        // dislocation, so pushing the stock pool around through the hook costs more than the same
        // round trip without it. Measured at 2,000 NVDA: -76,206 USDG against -2,288.
        assertLt(withHook, withoutHook, "manipulating the stock pool through the hook must not pay");
    }

    /// @notice Just-in-time liquidity. The hook donates its profit to whoever is in range in the
    ///         triggering pool at that instant, so liquidity added just before a dislocating swap
    ///         and removed straight after takes a share of a donation it did nothing to earn.
    ///
    /// @dev Measured, not asserted. In every configuration tried the JIT position lost more to the
    ///      flow it absorbed than it gained from the donation:
    ///
    ///          liquidity  range         buyer     donated   JIT result
    ///          2e17       +/-20 ticks   $50k        49 USDG   -113 USDG
    ///          5e16       +/-20 ticks   $50k       282 USDG    -24 USDG
    ///          1e17       +/-60 ticks   $200k    3,501 USDG  -1,686 USDG
    ///
    ///      So it did not pay at these sizes. It was not ruled out against a pool whose flow is
    ///      mostly uninformed, and a 2026 review confirmed the round trip itself was open. The hook
    ///      now holds new liquidity for MIN_LIQUIDITY_AGE (AUDIT-27), so a sniper has to stay.
    function test_ECON03_justInTimeLiquidityCannotLeaveWithTheDonation() public {
        address jit = makeAddr("jit");
        usdg.mint(jit, 10_000_000e6);
        nvda.mint(jit, 100_000e18);
        vm.startPrank(jit);
        nvda.approve(address(series), type(uint256).max);
        series.mint(50_000e18, jit);
        usdg.approve(address(liquidityRouter), type(uint256).max);
        f.approve(address(liquidityRouter), type(uint256).max);
        vm.stopPrank();

        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(floorKey.toId());
        int24 lower = (tick / 60 - 60) * 60;
        int24 upper = (tick / 60 + 60) * 60;
        IPoolManager.ModifyLiquidityParams memory pos = IPoolManager.ModifyLiquidityParams({
            tickLower: lower, tickUpper: upper, liquidityDelta: 1e17, salt: bytes32("jit")
        });

        uint256 fBefore = f.balanceOf(jit);
        uint256 qBefore = usdg.balanceOf(jit);

        vm.prank(jit);
        liquidityRouter.modifyLiquidity(floorKey, pos, "");

        // An honest buyer takes $50k of the floor half. Parity breaks, the hook closes it, and the
        // profit is donated into this pool while the JIT position is sitting in range.
        vm.recordLogs();
        _swap(floorKey, _isZero(floorKey, address(usdg)), -int256(uint256(200_000e6)));
        uint256 donated = _donatedProfit();

        assertGt(donated, 0, "the hook acted");

        // AUDIT-27: the round trip is closed. The position cannot leave in the block it arrived,
        // nor collect the donation's fees, until it has stood in the pool for an hour.
        pos.liquidityDelta = -1e17;
        uint256 withdrawableAt = block.timestamp + hook.MIN_LIQUIDITY_AGE();
        vm.prank(jit);
        vm.expectRevert();
        liquidityRouter.modifyLiquidity(floorKey, pos, "");

        pos.liquidityDelta = 0; // fee collection goes through the same gate
        vm.prank(jit);
        vm.expectRevert();
        liquidityRouter.modifyLiquidity(floorKey, pos, "");

        // After the hold it is an ordinary LP again, having carried an hour of real exposure.
        vm.warp(withdrawableAt);
        pos.liquidityDelta = -1e17;
        vm.prank(jit);
        liquidityRouter.modifyLiquidity(floorKey, pos, "");

        // Value the JIT round trip at the floor pool's own closing price.
        uint256 pF = priceX96(floorKey, address(f));
        int256 fDelta = int256(f.balanceOf(jit)) - int256(fBefore);
        int256 qDelta = int256(usdg.balanceOf(jit)) - int256(qBefore);
        int256 fValue = fDelta * int256(pF) / int256(1 << 96);
        int256 pnl = qDelta + fValue;

        console.log("hook profit donated to the floor pool (USDG):", donated / 1e6);
        console.log("JIT position net result, marked at close (USDG):");
        console.logInt(pnl / 1e6);
    }

    function _donatedProfit() private returns (uint256 profit) {
        bytes32 topic = keccak256("ParityRestored(bool,uint256,uint256)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == topic) {
                (,, profit) = abi.decode(logs[i].data, (bool, uint256, uint256));
            }
        }
    }

    function _roundTrip(bool triggerHook) private returns (int256 pnl) {
        int256 start = _markToMarket(trader);

        uint160 openSqrt = _sqrt(underlyingKey);
        _swap(underlyingKey, _isZero(underlyingKey, address(nvda)), -int256(uint256(2_000e18)));
        if (triggerHook) _swap(floorKey, _isZero(floorKey, address(usdg)), -int256(uint256(1e6)));

        // Buy the stock pool back to exactly where it opened.
        bool back = !_isZero(underlyingKey, address(nvda));
        vm.prank(trader);
        swapRouter.swap(
            underlyingKey,
            IPoolManager.SwapParams({zeroForOne: back, amountSpecified: -int256(uint256(1e30)), sqrtPriceLimitX96: openSqrt}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        if (triggerHook) _swap(floorKey, _isZero(floorKey, address(usdg)), -int256(uint256(1e6)));

        pnl = _markToMarket(trader) - start;
    }

    function _markToMarket(address who) private view returns (int256) {
        return int256(usdg.balanceOf(who)) + int256(nvda.balanceOf(who) * P_UNDER / 1e18)
            + int256(f.balanceOf(who) * P_FLOOR / 1e18) + int256(u.balanceOf(who) * P_UPSIDE / 1e18);
    }

    function _sqrt(PoolKey memory key) private view returns (uint160 s) {
        (s,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
    }

    function _isZero(PoolKey memory key, address token) private pure returns (bool) {
        return Currency.unwrap(key.currency0) == token;
    }

    function _bps(uint256 a, uint256 b) private pure returns (uint256) {
        uint256 d = a > b ? a - b : b - a;
        return d * 10_000 / a;
    }
}
