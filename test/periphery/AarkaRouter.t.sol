// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HookBaseTest} from "../hook/HookBase.t.sol";
import {AarkaRouter} from "../../src/periphery/AarkaRouter.sol";
import {AarkaSeries} from "../../src/AarkaSeries.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";

/// @notice The one-transaction product flow, against the same hooked pools the parity tests use.
contract AarkaRouterTest is HookBaseTest {
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
}
