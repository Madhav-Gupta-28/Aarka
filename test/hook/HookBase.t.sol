// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";

import {AarkaSeries} from "../../src/AarkaSeries.sol";
import {AarkaToken} from "../../src/AarkaToken.sol";
import {AarkaFactory} from "../../src/AarkaFactory.sol";
import {ExpiryCalendar} from "../../src/ExpiryCalendar.sol";
import {AarkaParityHook} from "../../src/hook/AarkaParityHook.sol";
import {AggregatorV3Interface} from "../../src/interfaces/IExternal.sol";
import {MockAggregator, MockSequencerFeed} from "../mocks/MockAggregator.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";

/// @notice Six-decimal quote token, matching USDG on Robinhood Chain.
contract MockUSDG is MockStockToken {
    constructor() MockStockToken("USDG", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// @dev Mirrors production: the underlying/quote pool already exists on Robinhood Chain and
///      carries no hook, because one cannot be attached to a live pool. Only the two Aarka
///      pools have the hook installed.
contract HookBaseTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 constant NOW = 1_790_000_000;
    uint64 constant EXPIRY = 1_790_366_400;
    uint256 constant STRIKE = 230e8;
    uint256 constant Q96 = 1 << 96;

    // Starting marks. The halves sum to the underlying, so the pools begin exactly at parity.
    uint256 constant P_UNDER = 215e6; // $215.00 in USDG units
    uint256 constant P_FLOOR = 180e6;
    uint256 constant P_UPSIDE = 35e6;

    address owner = makeAddr("owner");
    address trader = makeAddr("trader");
    address lp = makeAddr("lp");

    PoolManager manager;
    PoolModifyLiquidityTest liquidityRouter;
    PoolSwapTest swapRouter;

    MockStockToken nvda;
    MockUSDG usdg;
    AarkaSeries series;
    AarkaToken f;
    AarkaToken u;
    AarkaParityHook hook;

    PoolKey underlyingKey;
    PoolKey floorKey;
    PoolKey upsideKey;

    function setUp() public virtual {
        vm.warp(NOW);

        manager = new PoolManager(address(this));
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        swapRouter = new PoolSwapTest(manager);

        nvda = new MockStockToken("Robinhood NVDA", "NVDA");
        usdg = new MockUSDG();

        _deploySeries();
        _deployHook();
        _initialisePools();
        _seedLiquidity();
    }

    function _deploySeries() private {
        MockAggregator feed = new MockAggregator();
        feed.pushRound(100, 215e8, NOW - 60);
        MockSequencerFeed seq = new MockSequencerFeed();

        ExpiryCalendar calendar = new ExpiryCalendar(owner);
        AarkaFactory factory = new AarkaFactory(owner, calendar, AggregatorV3Interface(address(seq)));

        vm.startPrank(owner);
        uint64[] memory dates = new uint64[](1);
        dates[0] = EXPIRY;
        calendar.addExpiries(dates);
        factory.registerAsset(address(nvda), AggregatorV3Interface(address(feed)));
        vm.stopPrank();

        series = AarkaSeries(factory.createSeries(address(nvda), STRIKE, EXPIRY));
        f = series.floorToken();
        u = series.upsideToken();
    }

    /// @dev v4 reads hook permissions from the low 14 bits of the address, so the deployment
    ///      address has to be mined with CREATE2. Getting this wrong is the classic way a first
    ///      v4 hook fails, and the constructor asserts it rather than trusting the deploy script.
    function _deployHook() private {
        uint160 flags = uint160(Hooks.AFTER_SWAP_FLAG);
        bytes memory args =
            abi.encode(IPoolManager(address(manager)), series, Currency.wrap(address(usdg)), owner);
        (address expected, bytes32 salt) =
            HookMiner.find(address(this), flags, type(AarkaParityHook).creationCode, args);

        hook = new AarkaParityHook{salt: salt}(
            IPoolManager(address(manager)), series, Currency.wrap(address(usdg)), owner
        );
        assertEq(address(hook), expected, "mined address mismatch");
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, Hooks.AFTER_SWAP_FLAG, "wrong flags");
    }

    function _initialisePools() private {
        underlyingKey = _key(address(nvda), address(usdg), IHooks(address(0)));
        floorKey = _key(address(f), address(usdg), IHooks(address(hook)));
        upsideKey = _key(address(u), address(usdg), IHooks(address(hook)));

        manager.initialize(underlyingKey, _sqrtPrice(underlyingKey, address(nvda), P_UNDER));
        manager.initialize(floorKey, _sqrtPrice(floorKey, address(f), P_FLOOR));
        manager.initialize(upsideKey, _sqrtPrice(upsideKey, address(u), P_UPSIDE));

        vm.startPrank(owner);
        hook.wire(underlyingKey, floorKey, upsideKey);
        hook.setParams(30, 10e18);
        vm.stopPrank();
    }

    function _seedLiquidity() private {
        nvda.mint(lp, 200_000e18);
        usdg.mint(lp, 200_000_000e6);

        vm.startPrank(lp);
        nvda.approve(address(series), type(uint256).max);
        series.mint(100_000e18, lp);

        nvda.approve(address(liquidityRouter), type(uint256).max);
        usdg.approve(address(liquidityRouter), type(uint256).max);
        f.approve(address(liquidityRouter), type(uint256).max);
        u.approve(address(liquidityRouter), type(uint256).max);

        _addLiquidity(underlyingKey);
        _addLiquidity(floorKey);
        _addLiquidity(upsideKey);
        vm.stopPrank();

        nvda.mint(trader, 50_000e18);
        usdg.mint(trader, 50_000_000e6);
        vm.startPrank(trader);
        nvda.approve(address(series), type(uint256).max);
        series.mint(20_000e18, trader);
        nvda.approve(address(swapRouter), type(uint256).max);
        usdg.approve(address(swapRouter), type(uint256).max);
        f.approve(address(swapRouter), type(uint256).max);
        u.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();
    }

    function _addLiquidity(PoolKey memory key) internal {
        liquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(key.tickSpacing),
                tickUpper: TickMath.maxUsableTick(key.tickSpacing),
                liquidityDelta: 2_000_000e18,
                salt: 0
            }),
            ""
        );
    }

    function _key(address a, address b, IHooks hooks_) internal pure returns (PoolKey memory) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: hooks_
        });
    }

    /// @dev sqrtPriceX96 for "one whole asset costs `quotePrice` quote units". Assets are 18
    ///      decimals and the quote is 6, so the raw price is quote-wei per asset-wei.
    function _sqrtPrice(PoolKey memory key, address asset, uint256 quotePrice)
        internal
        pure
        returns (uint160)
    {
        uint256 num;
        uint256 den;
        if (Currency.unwrap(key.currency0) == asset) {
            (num, den) = (quotePrice, 1e18);
        } else {
            (num, den) = (1e18, quotePrice);
        }
        return uint160(Math.sqrt(FullMath.mulDiv(num, Q96 * Q96, den)));
    }

    /// @notice Price of `asset` in quote terms, X96, exactly as the hook computes it.
    function priceX96(PoolKey memory key, address asset) internal view returns (uint256) {
        (uint160 sqrtP,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        uint256 p = FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96);
        if (Currency.unwrap(key.currency0) == asset) return p;
        return FullMath.mulDiv(Q96, Q96, p);
    }

    function parityGapBps() internal view returns (uint256) {
        uint256 pN = priceX96(underlyingKey, address(nvda));
        uint256 sum = priceX96(floorKey, address(f)) + priceX96(upsideKey, address(u));
        uint256 gap = sum > pN ? sum - pN : pN - sum;
        return FullMath.mulDiv(gap, 10_000, pN);
    }

    function _swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified) internal {
        vm.prank(trader);
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }
}
