// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {Vm} from "forge-std/Vm.sol";

import {MainnetBase} from "./MainnetBase.t.sol";
import {AarkaSeries} from "../../../src/AarkaSeries.sol";
import {AarkaParityHook} from "../../../src/hook/AarkaParityHook.sol";
import {HookLens} from "../../../src/HookLens.sol";

/// @notice The parity hook on real mainnet, arbitraging against the live NVDA/USDG and TSLA/USDG
///         pools. NVDA sorts after USDG and TSLA before it, so the two markets between them put
///         the stock on both sides of its pool, as they will be on launch day.
contract MainnetHookTest is MainnetBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    AarkaSeries nv;
    AarkaSeries ts;

    function setUp() public {
        _forkA();
        nv = _create(NVDA, 230e8);
        ts = _create(TSLA, 350e8);
        _approveRouter(trader);
        _fund(trader, 0, 0, 10_000_000e6);
    }

    // ------------------------------------------------------------------ the two arbitrages, both stocks

    /// @dev Halves dear: buy the stock in the live pool, split it, sell both halves.
    function test_mintArb_nvda() public {
        Market memory m = _openMarket(nv, 9_500, 2_000e18, 1_000e18);
        (bool acted, bool minted,, uint256 profit) = _tradeAndWatch(m, m.floorKey, USDG, 50_000e6);
        assertTrue(acted && minted);
        assertGt(profit, 0);
        assertLt(_gapBps(m), 100);
    }

    /// @dev Halves cheap: buy both halves, recombine them, sell the stock into the live pool.
    function test_redeemArb_nvda() public {
        Market memory m = _openMarket(nv, 9_500, 2_000e18, 1_000e18);
        _mintPair(nv, trader, 300e18);
        _approveHalves(trader, m);
        (bool acted, bool minted, uint256 size, uint256 profit) =
            _tradeAndWatch(m, m.floorKey, address(m.floor), 200e18);
        assertTrue(acted);
        assertFalse(minted, "the redeem direction");
        assertGt(profit, 0);
        assertLt(_gapBps(m), 100);
        console.log("redeem arb: %s pairs recombined, %s USDG-wei to LPs", size, profit);
    }

    function test_mintArb_tsla() public {
        Market memory m = _openMarket(ts, 9_000, 2_000e18, 1_000e18);
        (bool acted, bool minted,, uint256 profit) = _tradeAndWatch(m, m.upsideKey, USDG, 40_000e6);
        assertTrue(acted && minted);
        assertGt(profit, 0);
    }

    function test_redeemArb_tsla() public {
        Market memory m = _openMarket(ts, 9_000, 2_000e18, 1_000e18);
        _mintPair(ts, trader, 300e18);
        _approveHalves(trader, m);
        (bool acted, bool minted,, uint256 profit) = _tradeAndWatch(m, m.upsideKey, address(m.upside), 150e18);
        assertTrue(acted);
        assertFalse(minted);
        assertGt(profit, 0);
    }

    // ------------------------------------------------------------------ when it must stay out of the way

    function test_aSmallTradeIsBelowTheThreshold() public {
        Market memory m = _openMarket(nv, 9_500, 2_000e18, 1_000e18);
        (bool acted,,,) = _tradeAndWatch(m, m.floorKey, USDG, 100e6);
        assertFalse(acted);
        assertLt(_gapBps(m), 100);
    }

    function test_maxArbSizeZeroSwitchesTheHookOff() public {
        Market memory m = _openMarket(nv, 9_500, 2_000e18, 0);
        (bool acted,,,) = _tradeAndWatch(m, m.floorKey, USDG, 50_000e6);
        assertFalse(acted);
        assertGt(_gapBps(m), 100, "left open, as asked");
    }

    /// @dev Fees across three pools cost about 90 bps. Told to act on any gap, the hook still
    ///      refuses a trade that would lose money.
    function test_itNeverTakesALosingTrade() public {
        Market memory m = _openMarket(nv, 9_500, 2_000e18, 1_000e18);
        vm.prank(owner);
        m.hook.setParams(1, 1_000e18);
        (bool acted,,,) = _tradeAndWatch(m, m.floorKey, USDG, 1_500e6);
        assertFalse(acted, "a 50-bps gap is not worth 90 bps of fees");
    }

    /// @dev A pool with no liquidity cannot be traded against, so there is no size to solve for.
    function test_noLiquidityNoArb() public {
        uint256 pUnder = _poolPrice(_livePool(NVDA), NVDA);
        Market memory m =
            _openCustom(nv, _livePool(NVDA), 9_500, _liquidityFor(2_000e18, pUnder * 95 / 100), 0, 1_000e18);
        (bool acted,,,) = _tradeAndWatch(m, m.floorKey, USDG, 50_000e6);
        assertFalse(acted);
    }

    /// @dev A pool so thin that even one wei of the trade would flip the gap: nothing to do.
    function test_aPoolTooThinForEvenOneWei() public {
        uint256 pUnder = _poolPrice(_livePool(NVDA), NVDA);
        Market memory m = _openCustom(nv, _livePool(NVDA), 9_500, 1e6, _liquidityFor(2_000e18, pUnder / 20), 1_000e18);
        (bool acted,,,) = _tradeAndWatch(m, m.floorKey, USDG, 1e6);
        assertFalse(acted);
    }

    /// @dev Halves cheap, and the upside pool holds so little that the most it could sell is 0.
    function test_nothingToBuyMeansNothingToDo() public {
        uint256 pUnder = _poolPrice(_livePool(NVDA), NVDA);
        Market memory m = _openCustom(nv, _livePool(NVDA), 9_500, _liquidityFor(2_000e18, pUnder * 95 / 100), 1, 1_000e18);
        _mintPair(nv, trader, 300e18);
        _approveHalves(trader, m);
        (bool acted,,,) = _tradeAndWatch(m, m.floorKey, address(m.floor), 200e18);
        assertFalse(acted);
    }

    // ------------------------------------------------------------------ hostile and unlucky pools

    /// @dev Anyone can create a pool naming the hook. Its swaps reach afterSwap, and the hook must
    ///      not pay its arbitrage profit into a pool it never wired.
    function test_aStrangersPoolCannotDrawTheArbitrage() public {
        Market memory m = _openMarket(nv, 9_500, 2_000e18, 1_000e18);
        PoolKey memory rogue = _key(address(m.floor), USDG, 500, 10, IHooks(address(m.hook)));
        uint256 pFloor = _poolPrice(m.floorKey, address(m.floor));
        POOL_MANAGER.initialize(rogue, _sqrtPrice(rogue, address(m.floor), pFloor * 2));
        _addFullRange(rogue, _liquidityFor(1_000e18, pFloor * 2));

        (bool acted,,,) = _tradeAndWatch(m, rogue, USDG, 50_000e6);
        assertFalse(acted, "no arbitrage for a pool the hook does not know");
    }

    /// @notice AUDIT-28 on mainnet. The floor pool's liquidity is concentrated in a narrow range,
    ///         and the PoolManager holds floor tokens the pool cannot reach. The redeem arb's
    ///         exact-output leg fills only partly; the hook must unwind rather than end the
    ///         trader's transaction in debt.
    function test_AUDIT28_aPartialFillNeverRevertsTheTradersSwap() public {
        Market memory m = _openMarket(nv, 9_500, 2_000e18, 1_000e18);
        int256 l = int256(uint256(POOL_MANAGER.getLiquidity(m.floorKey.toId())));
        vm.warp(block.timestamp + 1 hours + 1);
        vm.startPrank(lp);
        liquidity.modifyLiquidity(
            m.floorKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: -l,
                salt: 0
            }),
            ""
        );
        (, int24 tick,,) = POOL_MANAGER.getSlot0(m.floorKey.toId());
        int24 lower = (tick / 60) * 60 - 60;
        if (tick < 0 && tick % 60 != 0) lower -= 60;
        liquidity.modifyLiquidity(
            m.floorKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: lower, tickUpper: lower + 180, liquidityDelta: l, salt: 0
            }),
            ""
        );
        m.floor.transfer(address(POOL_MANAGER), 1_000e18);
        vm.stopPrank();

        _mintPair(nv, trader, 1_000e18);
        _approveHalves(trader, m);
        uint256 gapBefore = _gapBps(m);
        _sell(trader, m.upsideKey, address(m.upside), 400e18); // must not revert
        assertGt(_gapBps(m), gapBefore, "the sale went through and the gap stays open");
    }

    /// @dev Wired to NVDA's real 0.05% pool, which holds a few hundred dollars. The hook buys
    ///      only what is really there, ends flat, and the trader's swap goes through.
    function test_aThinRealUnderlyingPoolCapsTheArb() public {
        PoolKey memory thin = _key(NVDA, USDG, 500, 10, IHooks(address(0)));
        uint256 pUnder = _poolPrice(thin, NVDA);
        uint256 reserveLive = IERC20(NVDA).balanceOf(address(POOL_MANAGER));
        Market memory m = _openCustom(
            nv, thin, 9_500, _liquidityFor(2_000e18, pUnder * 95 / 100), _liquidityFor(2_000e18, pUnder / 20), 1_000e18
        );
        (bool acted, bool minted, uint256 size,) = _tradeAndWatch(m, m.floorKey, USDG, 50_000e6);
        assertTrue(acted && minted);
        assertLt(size, 1e18, "less than one share: all the thin pool could sell");
        assertLe(IERC20(NVDA).balanceOf(address(POOL_MANAGER)), reserveLive, "it only ever bought");
    }

    /// @dev Whichever side of USDG a half sorts to decides which side of the pool the profit is
    ///      donated on. Token addresses depend on the build, so find a series whose floor sorts
    ///      before USDG and one whose floor sorts after, and run a profitable arb from each.
    function test_profitIsDonatedOnTheRightSideWhicheverWayTheHalvesSort() public {
        bool sawBefore;
        bool sawAfter;
        for (uint256 k = 200; k < 260 && !(sawBefore && sawAfter); ++k) {
            AarkaSeries s = _create(NVDA, k * 1e8);
            bool before = address(s.floorToken()) < USDG;
            if ((before && sawBefore) || (!before && sawAfter)) continue;
            Market memory m = _openMarket(s, 9_500, 2_000e18, 1_000e18);
            (bool acted, bool minted,, uint256 profit) = _tradeAndWatch(m, m.floorKey, USDG, 50_000e6);
            assertTrue(acted && minted);
            assertGt(profit, 0);
            if (before) sawBefore = true;
            else sawAfter = true;
            // The lens reads a half on whichever side it sorts.
            assertApproxEqAbs(hookLens.parity(m.hook).gapBps, 0, 100);
        }
        assertTrue(sawBefore && sawAfter, "found both orderings");
        assertGt(hookLens.parity(_openMarket(ts, 9_000, 500e18, 1_000e18).hook).underlyingPrice, 0, "TSLA sorts before USDG");
    }

    /// @notice AUDIT-30. The stock leg of the mint arb fills only partly: a pool whose liquidity is
    ///         packed into a narrow band looks deep to the solver and runs dry well before the
    ///         arb's size. Before the fix `take` pulled the full size from the PoolManager, which
    ///         holds thousands of real NVDA for other pools, the hook ended owing ~127 NVDA it never
    ///         bought, and the whole arb unwound. Now it splits and sells what it actually bought.
    function test_AUDIT30_aStockLegThatFillsOnlyPartlyStillCorrects() public {
        PoolKey memory narrow = _key(NVDA, USDG, 2500, 50, IHooks(address(0)));
        uint256 pUnder = _poolPrice(_livePool(NVDA), NVDA);
        POOL_MANAGER.initialize(narrow, _sqrtPrice(narrow, NVDA, pUnder));
        (, int24 tick,,) = POOL_MANAGER.getSlot0(narrow.toId());
        int24 lower = (tick / 50) * 50 - 50;
        _fund(lp, 50_000e18, 0, 20_000_000e6);
        vm.startPrank(lp);
        IERC20(NVDA).approve(address(liquidity), type(uint256).max);
        IERC20(USDG).approve(address(liquidity), type(uint256).max);
        liquidity.modifyLiquidity(
            narrow,
            IPoolManager.ModifyLiquidityParams({tickLower: lower, tickUpper: lower + 100, liquidityDelta: 5e17, salt: 0}),
            ""
        );
        vm.stopPrank();

        Market memory m = _openCustom(
            nv, narrow, 9_500, _liquidityFor(2_000e18, pUnder * 95 / 100), _liquidityFor(2_000e18, pUnder / 20), 1_000e18
        );
        uint256 vaultBefore = IERC20(NVDA).balanceOf(address(nv));
        (bool acted, bool minted, uint256 size, uint256 profit) = _tradeAndWatch(m, m.floorKey, USDG, 60_000e6);
        assertTrue(acted && minted, "it corrected with what the band could sell");
        assertGt(profit, 0);
        assertEq(IERC20(NVDA).balanceOf(address(nv)) - vaultBefore, size, "and split exactly that");
    }

    /// @dev Halves cheap, and the PoolManager holds none of the upside at all: its pool opened
    ///      exactly on a tick, with the only position starting at that tick, so the position is
    ///      in range yet holds only USDG. The most the hook could buy is zero, so it sizes nothing.
    function test_whenAHalfCannotBeBoughtThereIsNothingToSize() public {
        AarkaSeries s = _seriesWhere(false, false); // upside sorts after USDG: currency1
        address fl = address(s.floorToken());
        address up = address(s.upsideToken());
        uint256 pUnder = _poolPrice(_livePool(NVDA), NVDA);
        AarkaParityHook h = _mineHook(s);

        PoolKey memory fk = _key(fl, USDG, 3000, 60, IHooks(address(h)));
        PoolKey memory uk = _key(up, USDG, 10_000, 200, IHooks(address(h)));
        POOL_MANAGER.initialize(fk, _sqrtPrice(fk, fl, pUnder * 95 / 100));
        int24 t = TickMath.getTickAtSqrtPrice(_sqrtPrice(uk, up, pUnder / 20)) / 200 * 200;
        POOL_MANAGER.initialize(uk, TickMath.getSqrtPriceAtTick(t));
        vm.startPrank(owner);
        h.wire(_livePool(NVDA), fk, uk);
        h.setParams(100, 1_000e18);
        vm.stopPrank();

        _mintPair(s, lp, 5_000e18);
        deal(USDG, lp, 100_000_000e6);
        vm.startPrank(lp);
        IERC20(fl).approve(address(liquidity), type(uint256).max);
        IERC20(up).approve(address(liquidity), type(uint256).max);
        IERC20(USDG).approve(address(liquidity), type(uint256).max);
        vm.stopPrank();
        _addFullRange(fk, _liquidityFor(2_000e18, pUnder * 95 / 100));
        vm.prank(lp);
        liquidity.modifyLiquidity(
            uk, IPoolManager.ModifyLiquidityParams({tickLower: t, tickUpper: t + 2000, liquidityDelta: 1e15, salt: 0}), ""
        );
        assertGt(POOL_MANAGER.getLiquidity(uk.toId()), 0, "in range");
        assertEq(IERC20(up).balanceOf(address(POOL_MANAGER)), 0, "and holding none of the half");

        _mintPair(s, trader, 300e18);
        vm.prank(trader);
        IERC20(fl).approve(address(router), type(uint256).max);
        Market memory m;
        m.hook = h;
        (bool acted,,,) = _tradeAndWatch(m, fk, fl, 200e18);
        assertFalse(acted, "nothing to buy, so nothing sized");
    }

    /// @dev The owner may set the threshold to zero. At exact parity there is then no gap to
    ///      close, and the solver must stop before trading even one wei. The pools are opened at
    ///      sqrt prices solved so the halves sum to the live NVDA price exactly, and the trigger is
    ///      a one-wei sale that the 0.30% fee absorbs entirely, so no price moves.
    function test_atExactParityWithNoThresholdNothingTrades() public {
        AarkaSeries s = _seriesWhere(true, true); // floor sorts before USDG
        PoolKey memory under = _livePool(NVDA);
        AarkaParityHook h = _mineHook(s);
        PoolKey memory fk = _key(address(s.floorToken()), USDG, 3000, 60, IHooks(address(h)));
        PoolKey memory uk = _key(address(s.upsideToken()), USDG, 3000, 60, IHooks(address(h)));
        bool upIsZero = Currency.unwrap(uk.currency0) == address(s.upsideToken());

        (uint160 sqrtN,,,) = POOL_MANAGER.getSlot0(under.toId());
        uint256 pN = _x96(sqrtN, false); // NVDA is currency1 against USDG
        uint160 sqrtF;
        uint160 sqrtU;
        for (uint256 bps = 9_500; sqrtU == 0; ++bps) {
            sqrtF = _solveSqrt(pN * bps / 10_000, true);
            if (sqrtF == 0) continue;
            sqrtU = _solveSqrt(pN - _x96(sqrtF, true), upIsZero);
        }
        assertEq(_x96(sqrtF, true) + _x96(sqrtU, upIsZero), pN, "exact parity, to the unit");

        POOL_MANAGER.initialize(fk, sqrtF);
        POOL_MANAGER.initialize(uk, sqrtU);
        vm.startPrank(owner);
        h.wire(under, fk, uk);
        h.setParams(0, 1_000e18);
        vm.stopPrank();
        _mintPair(s, lp, 5_000e18);
        deal(USDG, lp, 100_000_000e6);
        vm.startPrank(lp);
        s.floorToken().approve(address(liquidity), type(uint256).max);
        s.upsideToken().approve(address(liquidity), type(uint256).max);
        IERC20(USDG).approve(address(liquidity), type(uint256).max);
        vm.stopPrank();
        _addFullRange(fk, _liquidityFor(2_000e18, _poolPrice(under, NVDA) * 95 / 100));
        _addFullRange(uk, _liquidityFor(2_000e18, _poolPrice(under, NVDA) / 20));

        _mintPair(s, trader, 1);
        address fl = address(s.floorToken());
        vm.prank(trader);
        IERC20(fl).approve(address(router), 1);
        vm.recordLogs();
        vm.prank(trader);
        router.swapExactIn(fk, true, 1, 0, trader);
        (uint160 after_,,,) = POOL_MANAGER.getSlot0(fk.toId());
        assertEq(after_, sqrtF, "the fee took the wei; no price moved");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(
                logs[i].emitter != address(h) || logs[i].topics[0] != AarkaParityHook.ParityRestored.selector,
                "no trade at exact parity"
            );
        }
    }

    /// @dev A series whose floor (or upside) sorts before or after USDG, found by trying strikes.
    function _seriesWhere(bool floorSide, bool before) internal returns (AarkaSeries s) {
        for (uint256 k = 200; k < 300; ++k) {
            s = _create(NVDA, k * 1e8);
            address half = floorSide ? address(s.floorToken()) : address(s.upsideToken());
            if ((half < USDG) == before) return s;
        }
        revert("no such series");
    }

    /// @dev The hook's own price formula, so the parity is exact in its terms.
    function _x96(uint160 sqrtP, bool assetIsZero) internal pure returns (uint256) {
        if (assetIsZero) return FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96);
        uint256 half = FullMath.mulDiv(Q96, Q96, uint256(sqrtP));
        return FullMath.mulDiv(half, Q96, uint256(sqrtP));
    }

    /// @dev The sqrt price whose X96 price is exactly `target`, or 0 if none is.
    function _solveSqrt(uint256 target, bool assetIsZero) internal pure returns (uint160) {
        uint256 lo = TickMath.MIN_SQRT_PRICE;
        uint256 hi = TickMath.MAX_SQRT_PRICE;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            uint256 p = _x96(uint160(mid), assetIsZero);
            bool below = assetIsZero ? p < target : p > target; // price rises with s for asset0
            if (below) lo = mid + 1;
            else hi = mid;
        }
        return _x96(uint160(lo), assetIsZero) == target ? uint160(lo) : 0;
    }

    // ------------------------------------------------------------------ wiring and access

    function test_wiringRules() public {
        Market memory m = _openMarket(nv, 9_500, 100e18, 1_000e18);
        vm.startPrank(owner);
        vm.expectRevert(AarkaParityHook.AlreadyWired.selector);
        m.hook.wire(m.underlyingKey, m.floorKey, m.upsideKey);
        vm.stopPrank();

        AarkaParityHook fresh = _mineHook(nv);
        PoolKey memory f = _key(address(nv.floorToken()), USDG, 3000, 60, IHooks(address(fresh)));
        PoolKey memory u = _key(address(nv.upsideToken()), USDG, 3000, 60, IHooks(address(fresh)));
        PoolKey memory under = _livePool(NVDA);

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        fresh.wire(under, f, u);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        fresh.setParams(1, 1);
        vm.stopPrank();

        vm.startPrank(owner);
        vm.expectRevert(AarkaParityHook.PoolMismatch.selector);
        fresh.wire(f, under, u); // pools in the wrong slots
        vm.expectRevert(AarkaParityHook.PoolMismatch.selector);
        fresh.wire(under, m.floorKey, u); // a floor pool carrying another hook
        vm.expectRevert(AarkaParityHook.PoolNotInitialised.selector);
        fresh.wire(under, f, u); // its own pools, never initialised
        vm.stopPrank();
    }

    function test_aHookAtAnUnminedAddressRefusesToDeploy() public {
        vm.expectRevert(AarkaParityHook.InvalidHookAddress.selector);
        new AarkaParityHook(POOL_MANAGER, nv, Currency.wrap(USDG), owner);
    }

    function test_onlyThePoolManagerAndTheHookItselfMayCall() public {
        Market memory m = _openMarket(nv, 9_500, 100e18, 1_000e18);
        IPoolManager.SwapParams memory sp = IPoolManager.SwapParams(true, -1, 0);
        IPoolManager.ModifyLiquidityParams memory lpp = IPoolManager.ModifyLiquidityParams(0, 60, 1, 0);

        vm.expectRevert(AarkaParityHook.NotPoolManager.selector);
        m.hook.afterSwap(alice, m.floorKey, sp, BalanceDelta.wrap(0), "");
        vm.expectRevert(AarkaParityHook.NotPoolManager.selector);
        m.hook.afterAddLiquidity(alice, m.floorKey, lpp, BalanceDelta.wrap(0), BalanceDelta.wrap(0), "");
        vm.expectRevert(AarkaParityHook.NotPoolManager.selector);
        m.hook.beforeRemoveLiquidity(alice, m.floorKey, lpp, "");
        vm.expectRevert(AarkaParityHook.NotSelf.selector);
        m.hook.restoreParity(m.floorKey, 0);
    }

    /// @dev The entry points whose permission bits the address does not carry. v4 never calls
    ///      them; they revert so a mis-mined address fails loudly.
    function test_unusedEntryPointsRevert() public {
        Market memory m = _openMarket(nv, 9_500, 100e18, 1_000e18);
        IPoolManager.SwapParams memory sp = IPoolManager.SwapParams(true, -1, 0);
        IPoolManager.ModifyLiquidityParams memory lpp = IPoolManager.ModifyLiquidityParams(0, 60, 1, 0);
        bytes4 err = AarkaParityHook.HookNotImplemented.selector;

        vm.expectRevert(err);
        m.hook.beforeInitialize(alice, m.floorKey, 1);
        vm.expectRevert(err);
        m.hook.afterInitialize(alice, m.floorKey, 1, 0);
        vm.expectRevert(err);
        m.hook.beforeAddLiquidity(alice, m.floorKey, lpp, "");
        vm.expectRevert(err);
        m.hook.afterRemoveLiquidity(alice, m.floorKey, lpp, BalanceDelta.wrap(0), BalanceDelta.wrap(0), "");
        vm.expectRevert(err);
        m.hook.beforeSwap(alice, m.floorKey, sp, "");
        vm.expectRevert(err);
        m.hook.beforeDonate(alice, m.floorKey, 1, 1, "");
        vm.expectRevert(err);
        m.hook.afterDonate(alice, m.floorKey, 1, 1, "");
    }

    /// @dev An unwired hook's pools still trade; the hook simply does nothing yet.
    function test_anUnwiredHookStaysOutOfTheWay() public {
        AarkaParityHook fresh = _mineHook(nv);
        vm.prank(owner);
        fresh.setParams(100, 1_000e18);
        PoolKey memory f = _key(address(nv.floorToken()), USDG, 3000, 60, IHooks(address(fresh)));
        uint256 pFloor = _poolPrice(_livePool(NVDA), NVDA) * 95 / 100;
        POOL_MANAGER.initialize(f, _sqrtPrice(f, address(nv.floorToken()), pFloor));
        _mintPair(nv, lp, 1_000e18);
        deal(USDG, lp, 1_000_000e6);
        vm.startPrank(lp);
        nv.floorToken().approve(address(liquidity), type(uint256).max);
        IERC20(USDG).approve(address(liquidity), type(uint256).max);
        vm.stopPrank();
        _addFullRange(f, _liquidityFor(500e18, pFloor));
        _sell(trader, f, USDG, 1_000e6);
        assertFalse(fresh.wired());
        assertFalse(hookLens.parity(fresh).wired, "and the lens says so");
    }

    // ------------------------------------------------------------------ the liquidity hold (AUDIT-27)

    function test_liquidityMustStayAnHour() public {
        Market memory m = _openMarket(nv, 9_500, 1_000e18, 1_000e18);
        int256 l = int256(uint256(POOL_MANAGER.getLiquidity(m.floorKey.toId())));
        IPoolManager.ModifyLiquidityParams memory out = IPoolManager.ModifyLiquidityParams({
            tickLower: TickMath.minUsableTick(60),
            tickUpper: TickMath.maxUsableTick(60),
            liquidityDelta: -l,
            salt: 0
        });

        vm.prank(lp);
        vm.expectRevert(); // LiquidityTooNew, wrapped by the PoolManager
        liquidity.modifyLiquidity(m.floorKey, out, "");

        vm.warp(block.timestamp + m.hook.MIN_LIQUIDITY_AGE());
        vm.prank(lp);
        liquidity.modifyLiquidity(m.floorKey, out, "");
    }

    // ------------------------------------------------------------------ HookLens

    function test_hookLensReadsTheMarket() public {
        Market memory m = _openMarket(nv, 9_500, 2_000e18, 1_000e18);
        HookLens.Parity memory p = hookLens.parity(m.hook);
        assertTrue(p.wired);
        assertEq(p.series, address(nv));
        assertEq(p.quote, USDG);
        assertApproxEqRel(p.underlyingPrice, _poolPrice(_livePool(NVDA), NVDA), 1e12);
        assertApproxEqAbs(p.sumOfHalves, p.underlyingPrice, p.underlyingPrice / 1_000);
        assertGt(p.underlyingLiquidity, 0);
        assertEq(p.maxArbSize, 1_000e18);

        // Push the halves dear and check the lens reports the direction.
        _sell(trader, m.floorKey, USDG, 20_000e6);
        vm.prank(owner);
        m.hook.setParams(100, 0); // no arb, so the gap stays to be read
        _sell(trader, m.floorKey, USDG, 20_000e6);
        assertTrue(hookLens.parity(m.hook).halvesDear);
    }

    /// @notice AUDIT-31. HookLens used to rebuild the underlying pool's key as the hookless
    ///         0.30% tier. NVDA's deepest real pool is the 0.01% tier (~$25m against ~$9.9m), and
    ///         a hook wired there was shown with the other pool's liquidity and price. It now reads
    ///         the keys the hook was wired with.
    function test_AUDIT31_hookLensReadsThePoolTheHookIsWiredTo() public {
        PoolKey memory deepest = _key(NVDA, USDG, 100, 1, IHooks(address(0)));
        uint256 pUnder = _poolPrice(deepest, NVDA);
        Market memory m = _openCustom(
            nv, deepest, 9_500, _liquidityFor(500e18, pUnder * 95 / 100), _liquidityFor(500e18, pUnder / 20), 1_000e18
        );
        (,,,, uint24 fee,) = _wiredUnderlying(m.hook);
        assertEq(fee, 100, "the hook arbitrages against the 0.01% pool");

        HookLens.Parity memory p = hookLens.parity(m.hook);
        assertEq(p.underlyingLiquidity, POOL_MANAGER.getLiquidity(deepest.toId()), "and the lens reads that pool");
        assertTrue(p.underlyingLiquidity != POOL_MANAGER.getLiquidity(_livePool(NVDA).toId()));
        assertApproxEqRel(p.underlyingPrice, pUnder, 1e12);
        assertLt(p.gapBps, 5, "at parity against the pool it actually uses");
    }

    function _wiredUnderlying(AarkaParityHook h)
        internal
        view
        returns (Currency, Currency, uint24, int24, uint24 fee, IHooks)
    {
        (Currency c0, Currency c1, uint24 f, int24 sp, IHooks hk) = h.underlyingKey();
        return (c0, c1, f, sp, f, hk);
    }

    // ------------------------------------------------------------------ helpers

    function _find(bytes memory args) internal view returns (address a, bytes32 salt) {
        bytes memory code = abi.encodePacked(type(AarkaParityHook).creationCode, args);
        bytes32 h = keccak256(code);
        for (uint256 i; i < 200_000; ++i) {
            salt = bytes32(i);
            a = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, h)))));
            if (uint160(a) & 0x3FFF == HOOK_FLAGS && a.code.length == 0) return (a, salt);
        }
        revert("no salt");
    }

    /// @dev Trades and reports whether the hook acted, in which direction, at what size, for what profit.
    function _tradeAndWatch(Market memory m, PoolKey memory key, address tokenIn, uint256 amountIn)
        internal
        returns (bool acted, bool minted, uint256 size, uint256 profit)
    {
        vm.recordLogs();
        _sell(trader, key, tokenIn, amountIn);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = AarkaParityHook.ParityRestored.selector;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(m.hook) && logs[i].topics[0] == topic) {
                (minted, size, profit) = abi.decode(logs[i].data, (bool, uint256, uint256));
                return (true, minted, size, profit);
            }
        }
    }
}
