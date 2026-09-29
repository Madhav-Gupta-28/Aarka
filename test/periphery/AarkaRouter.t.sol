// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HookBaseTest} from "../hook/HookBase.t.sol";
import {AarkaRouter} from "../../src/periphery/AarkaRouter.sol";
import {AarkaSeries} from "../../src/AarkaSeries.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";

/// @notice The one-transaction product flow, against the same hooked pools the parity tests use.
contract AarkaRouterTest is HookBaseTest {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    AarkaRouter router;
    address holder = makeAddr("holder");

    function setUp() public override {
        super.setUp();
        router = new AarkaRouter(IPoolManager(address(manager)), factory);

        nvda.mint(holder, 1_000e18);
        usdg.mint(holder, 100_000e6);
        vm.startPrank(holder);
        nvda.approve(address(router), type(uint256).max);
        usdg.approve(address(router), type(uint256).max);
        f.approve(address(router), type(uint256).max);
        u.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _isZero(PoolKey memory key, address token) internal pure returns (bool) {
        return Currency.unwrap(key.currency0) == token;
    }

    /// @notice Keep the floor, sell the upside: one call, and the holder ends with floor tokens and
    ///         cash, nothing left in the router.
    function test_keepTheFloorSellTheUpside() public {
        vm.prank(holder);
        uint256 cash = router.splitAndSell(series, true, 10e18, upsideKey, 0, holder);

        assertEq(nvda.balanceOf(holder), 990e18, "ten shares went in");
        assertEq(f.balanceOf(holder), 10e18, "kept the floor");
        assertEq(u.balanceOf(holder), 0, "sold the upside");
        assertEq(usdg.balanceOf(holder), 100_000e6 + cash, "and was paid");

        // Ten upside tokens at a $35 mark, less the 0.3% fee and a little slippage.
        assertGt(cash, 340e6);
        assertLt(cash, 350e6);

        assertEq(nvda.balanceOf(address(router)), 0);
        assertEq(f.balanceOf(address(router)), 0);
        assertEq(u.balanceOf(address(router)), 0);
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function test_keepTheUpsideSellTheFloor() public {
        vm.prank(holder);
        uint256 cash = router.splitAndSell(series, false, 10e18, floorKey, 0, holder);
        assertEq(u.balanceOf(holder), 10e18);
        assertEq(f.balanceOf(holder), 0);
        assertGt(cash, 1_750e6); // ten floor tokens at a $180 mark
    }

    function test_slippageLimitRevertsTheWholeCall() public {
        vm.prank(holder);
        vm.expectRevert();
        router.splitAndSell(series, true, 10e18, upsideKey, 351e6, holder);
        assertEq(nvda.balanceOf(holder), 1_000e18, "nothing moved");
    }

    function test_refusesAContractTheFactoryDidNotCreate() public {
        vm.prank(holder);
        vm.expectRevert(AarkaRouter.NotASeries.selector);
        router.splitAndSell(AarkaSeries(address(0xBEEF)), true, 10e18, upsideKey, 0, holder);
    }

    function test_refusesAPoolThatDoesNotTradeTheHalfBeingSold() public {
        vm.prank(holder);
        vm.expectRevert(AarkaRouter.PoolDoesNotTradeThisHalf.selector);
        router.splitAndSell(series, true, 10e18, floorKey, 0, holder); // selling upside into the floor pool
    }

    function test_refusesZeroAndZeroAddress() public {
        vm.startPrank(holder);
        vm.expectRevert(AarkaRouter.InvalidAmount.selector);
        router.splitAndSell(series, true, 0, upsideKey, 0, holder);
        vm.expectRevert(AarkaRouter.ZeroAddress.selector);
        router.splitAndSell(series, true, 1e18, upsideKey, 0, address(0));
        vm.stopPrank();
    }

    /// @notice Buying the upside with cash — the other side of the market.
    function test_buyTheUpsideWithCash() public {
        vm.prank(holder);
        uint256 got = router.swapExactIn(upsideKey, _isZero(upsideKey, address(usdg)), 350e6, 0, holder);
        assertGt(got, 9e18);
        assertEq(u.balanceOf(holder), got);
    }

    function test_swapSlippageReverts() public {
        vm.prank(holder);
        vm.expectRevert();
        router.swapExactIn(upsideKey, _isZero(upsideKey, address(usdg)), 350e6, 11e18, holder);
    }

    /// @notice A size that dislocates the pool still triggers the hook, and parity is restored in
    ///         the same transaction exactly as it is for any other swapper.
    function test_theHookStillRestoresParityThroughTheRouter() public {
        nvda.mint(holder, 20_000e18);
        vm.prank(holder);
        router.splitAndSell(series, true, 5_000e18, upsideKey, 0, holder);
        assertLe(parityGapBps(), 30, "the hook closed the gap the sale opened");
    }

    function test_onlyThePoolManagerCanCallBack() public {
        vm.expectRevert(AarkaRouter.NotPoolManager.selector);
        router.unlockCallback("");
    }

    /// @notice The router pulls only from the caller. An approval someone else gave it is useless
    ///         to anyone but them.
    function test_cannotSpendSomeoneElsesApproval() public {
        address thief = makeAddr("thief");
        vm.prank(thief);
        vm.expectRevert();
        router.swapExactIn(upsideKey, _isZero(upsideKey, address(usdg)), 350e6, 0, thief);
        assertEq(usdg.balanceOf(holder), 100_000e6, "holder untouched");
    }

    /// @notice A pool too thin for the whole sale fills partly. The seller keeps what did not
    ///         sell, pays only for what did, and the router is left holding nothing.
    function test_aPartialFillReturnsTheUnsoldHalvesAndLeavesTheRouterEmpty() public {
        PoolKey memory thin = PoolKey({
            currency0: upsideKey.currency0, currency1: upsideKey.currency1, fee: 500, tickSpacing: 10,
            hooks: IHooks(address(0))
        });
        manager.initialize(thin, _sqrtPrice(thin, address(u), P_UPSIDE));
        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(thin.toId());
        int24 lower = (tick / 10) * 10 - 20;

        vm.prank(lp);
        u.approve(address(liquidityRouter), type(uint256).max);
        vm.prank(lp);
        liquidityRouter.modifyLiquidity(
            thin, IPoolManager.ModifyLiquidityParams({tickLower: lower, tickUpper: lower + 40, liquidityDelta: 1e12, salt: 0}), ""
        );

        vm.prank(holder);
        uint256 cash = router.splitAndSell(series, true, 10e18, thin, 0, holder);

        uint256 unsold = u.balanceOf(holder);
        assertGt(unsold, 0, "the pool could not take all ten");
        assertLt(unsold, 10e18, "but it took some");
        assertGt(cash, 0, "and paid for what it took");
        assertEq(f.balanceOf(holder), 10e18, "the kept half is whole");

        assertEq(nvda.balanceOf(address(router)), 0);
        assertEq(f.balanceOf(address(router)), 0);
        assertEq(u.balanceOf(address(router)), 0);
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function test_refusesNativeCurrencyPools() public {
        PoolKey memory native = PoolKey({
            currency0: Currency.wrap(address(0)), currency1: Currency.wrap(address(u)), fee: 3000, tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        vm.prank(holder);
        vm.expectRevert(AarkaRouter.NativeCurrencyUnsupported.selector);
        router.swapExactIn(native, true, 1e18, 0, holder);
        vm.prank(holder);
        vm.expectRevert(AarkaRouter.NativeCurrencyUnsupported.selector);
        router.splitAndSell(series, true, 1e18, native, 0, holder);
    }
}
