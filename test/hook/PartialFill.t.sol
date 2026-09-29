// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

import {HookBaseTest} from "./HookBase.t.sol";

/// @notice AUDIT-28. An arb leg that fills only partly must not leave the hook in debt.
///
/// @dev The redeem arb buys each half with an exact-output swap and then `take`s the full size.
///      `take` moves real tokens out of the PoolManager's whole balance of that currency, not the
///      pool's, so when the pool's reachable liquidity runs out before the size is filled, the take
///      still succeeds and the hook is left owing the difference. `_profit` looks only at the quote
///      currency, which the unpaid halves make look better rather than worse, so the arb returns
///      normally. The debt then surfaces at the end of the trader's unlock as CurrencyNotSettled,
///      outside the try/catch, and the trader's own swap reverts.
///
///      Two conditions, neither exotic on a live market. The hooked pool's in-range liquidity is
///      concentrated, so the virtual reserve `_maxOut` reads is far larger than what the range can
///      actually pay out. And the PoolManager holds more of the half than that pool does, which
///      anyone can arrange by transferring the tokens to it or by holding them in any other pool.
contract PartialFillTest is HookBaseTest {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @dev Replace the floor pool's full-range position with a narrow one straddling the price,
    ///      and put floor tokens in the PoolManager that the floor pool cannot reach.
    function _concentrateFloorLiquidity() private {
        vm.warp(block.timestamp + hook.MIN_LIQUIDITY_AGE() + 1);
        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(floorKey.toId());
        int24 lower = (tick / 60) * 60 - 60;
        if (tick < 0 && tick % 60 != 0) lower -= 60;

        vm.startPrank(lp);
        liquidityRouter.modifyLiquidity(
            floorKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -887220, tickUpper: 887220, liquidityDelta: -1e17, salt: 0
            }),
            ""
        );
        liquidityRouter.modifyLiquidity(
            floorKey,
            IPoolManager.ModifyLiquidityParams({tickLower: lower, tickUpper: lower + 180, liquidityDelta: 1e17, salt: 0}),
            ""
        );
        f.transfer(address(manager), 100_000e18);
        vm.stopPrank();
    }

    /// @notice The trader sells upsides, the halves go cheap, the hook runs the redeem arb, and
    ///         the trader's swap must still go through.
    function test_AUDIT28_aPartialFillNeverRevertsTheTradersSwap() public {
        _concentrateFloorLiquidity();
        uint256 gapBefore = parityGapBps();

        bool upsideIsZero = Currency.unwrap(upsideKey.currency0) == address(u);
        _swap(upsideKey, upsideIsZero, -int256(20_000e18));

        assertGt(parityGapBps(), gapBefore, "the sale opened a gap, and the swap went through");
    }
}
