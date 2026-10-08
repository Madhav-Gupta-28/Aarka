// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {BaseTestHooks} from "v4-core/src/test/BaseTestHooks.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";

import {MainnetBase} from "./MainnetBase.t.sol";
import {AarkaSeries} from "../../../src/AarkaSeries.sol";
import {AarkaRouter} from "../../../src/periphery/AarkaRouter.sol";
import {AggregatorV3Interface} from "../../../src/interfaces/IExternal.sol";

/// @notice The router on real mainnet: keep one half and sell the other in one transaction, plain
///         swaps in either direction through hooked and hookless pools, and every refusal.
contract MainnetRouterTest is MainnetBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    AarkaSeries nv;
    Market m;

    function setUp() public {
        _forkA();
        nv = _create(NVDA, 230e8);
        m = _openMarket(nv, 9_500, 2_000e18, 1_000e18);
        _fund(alice, 100e18, 0, 1_000_000e6);
        _approveRouter(alice);
        _approveHalves(alice, m);
    }

    // ------------------------------------------------------------------ split and sell

    function test_keepTheFloorSellTheUpside() public {
        uint256 cashBefore = IERC20(USDG).balanceOf(alice);
        vm.prank(alice);
        uint256 out = router.splitAndSell(nv, true, 3e18, m.upsideKey, 1, alice);
        assertEq(IERC20(USDG).balanceOf(alice) - cashBefore, out);
        assertEq(m.floor.balanceOf(alice), 3e18);
        assertEq(m.upside.balanceOf(alice), 0);
        _routerHoldsNothing();
    }

    function test_keepTheUpsideSellTheFloor() public {
        vm.prank(alice);
        uint256 out = router.splitAndSell(nv, false, 3e18, m.floorKey, 1, bob);
        assertEq(m.upside.balanceOf(bob), 3e18, "the kept half goes to `to`");
        assertEq(IERC20(USDG).balanceOf(bob), out, "and so does the cash");
        assertGt(out, 3 * 200e6, "three floors at about $220 each");
        _routerHoldsNothing();
    }

    /// @dev The upside pool holds liquidity only in a narrow band. Selling more than the band can
    ///      take fills partly; the unsold upsides come back instead of sitting in the router.
    function test_aPartialFillReturnsWhatDidNotSell() public {
        AarkaSeries s = _create(NVDA, 240e8);
        uint256 pUnder = _poolPrice(_livePool(NVDA), NVDA);
        Market memory thin = _openCustom(s, _livePool(NVDA), 9_500, _liquidityFor(2_000e18, pUnder * 95 / 100), 0, 0);
        (, int24 tick,,) = POOL_MANAGER.getSlot0(thin.upsideKey.toId());
        int24 lower = (tick / 60) * 60 - 120;
        vm.prank(lp);
        liquidity.modifyLiquidity(
            thin.upsideKey,
            IPoolManager.ModifyLiquidityParams({tickLower: lower, tickUpper: lower + 240, liquidityDelta: 1e15, salt: 0}),
            ""
        );

        vm.prank(alice);
        router.splitAndSell(s, true, 50e18, thin.upsideKey, 0, alice);
        uint256 back = thin.upside.balanceOf(alice);
        assertGt(back, 0, "the unsold upsides came back");
        assertLt(back, 50e18, "some did sell");
        assertEq(thin.floor.balanceOf(alice), 50e18);
        assertEq(thin.upside.balanceOf(address(router)), 0);
    }

    function test_splitAndSellRefusals() public {
        AarkaSeries stray = new AarkaSeries(
            IERC20(NVDA), AggregatorV3Interface(NVDA_FEED), AggregatorV3Interface(address(0)), 230e8, CLOSE_2OCT
        );
        PoolKey memory eth = _key(address(0), USDG, 3000, 60, IHooks(address(0)));

        vm.startPrank(alice);
        vm.expectRevert(AarkaRouter.NotASeries.selector);
        router.splitAndSell(stray, true, 1e18, m.upsideKey, 0, alice);
        vm.expectRevert(AarkaRouter.ZeroAddress.selector);
        router.splitAndSell(nv, true, 1e18, m.upsideKey, 0, address(0));
        vm.expectRevert(AarkaRouter.InvalidAmount.selector);
        router.splitAndSell(nv, true, 0, m.upsideKey, 0, alice);
        vm.expectRevert(AarkaRouter.InvalidAmount.selector);
        router.splitAndSell(nv, true, uint256(uint128(type(int128).max)) + 1, m.upsideKey, 0, alice);
        vm.expectRevert(AarkaRouter.PoolDoesNotTradeThisHalf.selector);
        router.splitAndSell(nv, false, 1e18, m.upsideKey, 0, alice); // selling the floor into the upside pool
        vm.expectRevert(AarkaRouter.NativeCurrencyUnsupported.selector);
        router.splitAndSell(nv, true, 1e18, eth, 0, alice);
        vm.stopPrank();
        uint256 quote = _quoteUpside(1e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AarkaRouter.InsufficientOutput.selector, quote, type(uint256).max));
        router.splitAndSell(nv, true, 1e18, m.upsideKey, type(uint256).max, alice);
    }

    // ------------------------------------------------------------------ plain swaps

    /// @dev Both directions through the live hookless NVDA pool, and through a hooked half pool.
    function test_swapsInEveryDirection() public {
        PoolKey memory live = _livePool(NVDA);
        bool nvdaIsZero = Currency.unwrap(live.currency0) == NVDA;

        uint256 nvdaBefore = IERC20(NVDA).balanceOf(alice);
        vm.prank(alice);
        uint256 got = router.swapExactIn(live, !nvdaIsZero, 1_000e6, 1, alice); // USDG in, NVDA out
        assertEq(IERC20(NVDA).balanceOf(alice) - nvdaBefore, got);
        assertApproxEqRel(got * _poolPrice(live, NVDA) / 1e18, 1_000e6, 0.01e18, "about $1,000 of NVDA at the live price");

        vm.prank(alice);
        uint256 cash = router.swapExactIn(live, nvdaIsZero, 1e18, 1, alice); // NVDA in, USDG out
        assertApproxEqRel(cash, _poolPrice(live, NVDA), 0.01e18);

        vm.prank(alice);
        uint256 floors = router.swapExactIn(
            m.floorKey, Currency.unwrap(m.floorKey.currency0) == USDG, 500e6, 1, alice
        );
        assertGt(floors, 0);
        _routerHoldsNothing();
    }

    function test_swapRefusals() public {
        PoolKey memory eth = _key(address(0), USDG, 3000, 60, IHooks(address(0)));
        vm.startPrank(alice);
        vm.expectRevert(AarkaRouter.ZeroAddress.selector);
        router.swapExactIn(m.floorKey, true, 1e6, 0, address(0));
        vm.expectRevert(AarkaRouter.InvalidAmount.selector);
        router.swapExactIn(m.floorKey, true, 0, 0, alice);
        vm.expectRevert(AarkaRouter.NativeCurrencyUnsupported.selector);
        router.swapExactIn(eth, false, 1e6, 0, alice);
        vm.expectRevert();
        router.swapExactIn(_livePool(NVDA), true, 1e6, type(uint256).max, alice);
        vm.stopPrank();

        vm.expectRevert(AarkaRouter.NotPoolManager.selector);
        router.unlockCallback("");
    }

    /// @notice A hostile pool. Its hook claims more of the output than the swap produced, which
    ///         would leave the router owing the difference. The router checks the sign of what it
    ///         is owed and refuses, rather than paying a pool more than it was asked to.
    function test_aHostilePoolCannotChargeTheRouterExtra() public {
        uint160 flags = Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        (, bytes32 salt) = HookMiner.find(address(this), flags, type(GreedyHook).creationCode, "");
        GreedyHook greedy = new GreedyHook{salt: salt}();
        PoolKey memory k = _key(NVDA, USDG, 3000, 60, IHooks(address(greedy)));
        POOL_MANAGER.initialize(k, _sqrtPrice(k, NVDA, _poolPrice(_livePool(NVDA), NVDA)));
        _fund(lp, 100e18, 0, 0);
        vm.startPrank(lp);
        IERC20(NVDA).approve(address(liquidity), type(uint256).max);
        vm.stopPrank();
        _addFullRange(k, _liquidityFor(50e18, _poolPrice(k, NVDA)));

        bool nvdaIsZero = Currency.unwrap(k.currency0) == NVDA;
        vm.prank(alice);
        vm.expectRevert(AarkaRouter.UnexpectedDelta.selector);
        router.swapExactIn(k, !nvdaIsZero, 100e6, 0, alice);
    }

    // ------------------------------------------------------------------ helpers

    function _routerHoldsNothing() internal view {
        assertEq(IERC20(NVDA).balanceOf(address(router)), 0);
        assertEq(IERC20(USDG).balanceOf(address(router)), 0);
        assertEq(m.floor.balanceOf(address(router)), 0);
        assertEq(m.upside.balanceOf(address(router)), 0);
    }

    /// @dev What a sale of `amount` upsides returns right now, by running it and rolling back.
    function _quoteUpside(uint256 amount) internal returns (uint256 out) {
        uint256 snap = vm.snapshotState();
        vm.prank(alice);
        out = router.splitAndSell(nv, true, amount, m.upsideKey, 0, alice);
        vm.revertToState(snap);
    }
}

/// @notice A hook that takes the whole output of every swap and then some.
contract GreedyHook is BaseTestHooks {
    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta delta, bytes calldata)
        external
        pure
        override
        returns (bytes4, int128)
    {
        int128 out = delta.amount0() > 0 ? delta.amount0() : delta.amount1();
        return (BaseTestHooks.afterSwap.selector, out + 1);
    }
}
