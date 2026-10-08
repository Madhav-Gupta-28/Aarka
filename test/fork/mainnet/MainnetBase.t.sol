// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

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
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";

import {AarkaSeries} from "../../../src/AarkaSeries.sol";
import {AarkaToken} from "../../../src/AarkaToken.sol";
import {AarkaFactory} from "../../../src/AarkaFactory.sol";
import {ExpiryCalendar} from "../../../src/ExpiryCalendar.sol";
import {AarkaLens} from "../../../src/AarkaLens.sol";
import {HookLens} from "../../../src/HookLens.sol";
import {AarkaParityHook} from "../../../src/hook/AarkaParityHook.sol";
import {AarkaRouter} from "../../../src/periphery/AarkaRouter.sol";
import {AarkaSequencerFeed} from "../../../src/adapters/AarkaSequencerFeed.sol";
import {AggregatorV3Interface} from "../../../src/interfaces/IExternal.sol";

/// @notice The real Robinhood Chain mainnet, as Aarka would meet it on launch day.
///
/// @dev Everything an Aarka user touches is the live contract: the NVDA and TSLA stock tokens,
///      Paxos USDG, the Chainlink RHNVDA/USD and RHTSLA/USD feeds, the Uniswap v4 PoolManager and
///      the existing NVDA/USDG and TSLA/USDG pools. Aarka's own contracts are deployed onto the
///      fork exactly as the deploy script would deploy them.
///
///      Two moments of real history are used, so a series can be created through the factory
///      before a real close and settled against the real closing round afterwards:
///
///        BLOCK_A  Mon 28 Sep 2026 14:00 UTC   the week before. Series are created and traded.
///        BLOCK_B  Thu  8 Oct 2026 07:28 UTC   after the Fri 2 Oct close. Series are settled.
///
///      Between the two, everything Aarka wrote (and the token and pool state it depends on) is
///      carried forward with `makePersistent`; the Chainlink feeds are not, so at BLOCK_B they hold
///      the rounds Chainlink actually published that week.
///
///      The public RPC keeps about an hour of history, so the suite forks an archive endpoint:
///
///        forge test --match-path "test/fork/mainnet/*"
///
///      `robinhood_archive` in foundry.toml points at dRPC's public Robinhood Chain endpoint.
abstract contract MainnetBase is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ------------------------------------------------------------------ real chain

    uint256 constant CHAIN_ID = 4663;
    uint256 constant BLOCK_A = 74_851_966; // 1790604000, Mon 28 Sep 2026 14:00 UTC
    uint256 constant BLOCK_B = 83_310_301; // 1791462108, Thu 8 Oct 2026

    /// @dev Fri 2 Oct 2026, 16:00 ET. The settlement every test series in this suite works towards.
    uint64 constant CLOSE_2OCT = 1_790_971_200;

    // Stock tokens: one beacon (which is also the issuer's role registry) behind every ticker.
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address constant STOCK_REGISTRY = 0xe10b6f6B275de231345c20D14Ab812db62151b00;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    // Chainlink. Round ids are (phaseId << 64) | aggregatorRound; both feeds are in phase 1.
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address constant TSLA_FEED = 0x4A1166a659A55625345e9515b32adECea5547C38;
    address constant AAPL_FEED = 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0;
    uint80 constant PHASE_1 = uint80(1 << 64);

    /// @dev The last round at or before the 2 Oct close, found by binary search over the live feed.
    ///      NVDA: $234.99711907, published 2.87 h before the close. Next round: 4 Oct 23:20 UTC.
    ///      TSLA: $370.448,      published 4.5 min before the close. Next round: 4 Oct 23:20 UTC.
    uint80 constant NVDA_CLOSE_ROUND = PHASE_1 | 1162;
    uint80 constant TSLA_CLOSE_ROUND = PHASE_1 | 1446;
    uint256 constant NVDA_CLOSE_PRICE = 23_499_711_907;
    uint256 constant TSLA_CLOSE_PRICE = 37_044_800_000;

    IPoolManager constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);

    // The issuer's role holders, each found by simulating the call from every RoleGranted account
    // the registry has ever emitted. Each holds exactly one power.
    address constant ISSUER_ORACLE_PAUSER = 0x7369d100c00F28E45D779ac9d4b1c7afa61e4aBC;
    address constant ISSUER_MULTIPLIER = 0x92905e8d0e2301BA143215B8D86D63fFD4188143;
    address constant ISSUER_MINTER = 0x2b94105fFf37630f98e1f24811daD588FC5C3A87;
    address constant ISSUER_TOKEN_PAUSER = 0xFCcF56B674113d9C4eb0F9B3370930ceD9E6Ab23;
    address constant ISSUER_BLOCKLISTER = 0x913cA87347391218e5De2C17c5A0AEba8B0b28fD;
    address constant ISSUER_BURNER = 0x957B6de6525C63349f7619743Ef1E0ad93cd74D4;

    // ------------------------------------------------------------------ Aarka, deployed on the fork

    uint160 constant HOOK_FLAGS =
        Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG;
    uint256 constant Q96 = 1 << 96;

    address owner = makeAddr("aarka-owner");
    address reporter = makeAddr("keeper");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address lp = makeAddr("lp");
    address trader = makeAddr("trader");

    ExpiryCalendar calendar;
    AarkaSequencerFeed sequencer;
    AarkaFactory factory;
    AarkaRouter router;
    AarkaLens lens;
    HookLens hookLens;
    PoolModifyLiquidityTest liquidity;

    /// @dev A series with its market: the hook and the three pools it watches.
    struct Market {
        AarkaSeries series;
        AarkaToken floor;
        AarkaToken upside;
        AarkaParityHook hook;
        PoolKey underlyingKey;
        PoolKey floorKey;
        PoolKey upsideKey;
    }

    // ------------------------------------------------------------------ setup

    function _forkA() internal {
        vm.createSelectFork("robinhood_archive", BLOCK_A);
        assertEq(block.chainid, CHAIN_ID, "Robinhood Chain mainnet");
        _deployAarka();
    }

    /// @dev Deploys Aarka the way script/Deploy.s.sol does on mainnet: calendar, the stopgap
    ///      sequencer feed (Chainlink publishes none for this chain), factory pointed at it,
    ///      then the periphery. Registers the two real feeds.
    function _deployAarka() internal {
        calendar = new ExpiryCalendar(owner);
        sequencer = new AarkaSequencerFeed(owner, reporter);
        factory = new AarkaFactory(owner, calendar, sequencer);
        router = new AarkaRouter(POOL_MANAGER, factory);
        lens = new AarkaLens(factory);
        hookLens = new HookLens(POOL_MANAGER);
        liquidity = new PoolModifyLiquidityTest(POOL_MANAGER);

        uint64[] memory dates = new uint64[](1);
        dates[0] = CLOSE_2OCT;
        vm.startPrank(owner);
        calendar.addExpiries(dates);
        factory.registerAsset(NVDA, AggregatorV3Interface(NVDA_FEED));
        factory.registerAsset(TSLA, AggregatorV3Interface(TSLA_FEED));
        vm.stopPrank();

        vm.prank(reporter);
        sequencer.report(true);
    }

    /// @dev Moves to BLOCK_B carrying Aarka and everything it changed. The feeds stay behind, so
    ///      they come back with the rounds Chainlink actually published during the week.
    function _toBlockB(address[] memory extra) internal {
        address[] memory keep = new address[](14 + extra.length);
        keep[0] = NVDA;
        keep[1] = TSLA;
        keep[2] = USDG;
        keep[3] = address(POOL_MANAGER);
        keep[4] = address(calendar);
        keep[5] = address(sequencer);
        keep[6] = address(factory);
        keep[7] = address(router);
        keep[8] = address(lens);
        keep[9] = address(hookLens);
        keep[10] = address(liquidity);
        keep[11] = alice;
        keep[12] = bob;
        keep[13] = lp;
        for (uint256 i; i < extra.length; ++i) {
            keep[14 + i] = extra[i];
        }
        vm.makePersistent(keep);
        vm.makePersistent(trader);
        for (uint256 i; i < factory.seriesCount(); ++i) {
            AarkaSeries s = AarkaSeries(factory.allSeries(i));
            vm.makePersistent(address(s), address(s.floorToken()), address(s.upsideToken()));
        }
        vm.rollFork(BLOCK_B);
    }

    function _toBlockB() internal {
        _toBlockB(new address[](0));
    }

    /// @dev The keeper's two reports that make the sequencer check pass: one to open a fresh "up"
    ///      round, and one an hour later to keep it fresh once the grace period is over.
    function _sequencerUpPastGrace() internal {
        vm.prank(reporter);
        sequencer.report(true);
        vm.warp(block.timestamp + 61 minutes);
        vm.prank(reporter);
        sequencer.report(true);
    }

    // ------------------------------------------------------------------ helpers: tokens

    /// @dev Real tokens, real balances: `deal` writes the token's own balance slot.
    function _fund(address who, uint256 nvda, uint256 tsla, uint256 usdg) internal {
        if (nvda != 0) deal(NVDA, who, IERC20(NVDA).balanceOf(who) + nvda);
        if (tsla != 0) deal(TSLA, who, IERC20(TSLA).balanceOf(who) + tsla);
        if (usdg != 0) deal(USDG, who, IERC20(USDG).balanceOf(who) + usdg);
    }

    function _mintPair(AarkaSeries s, address who, uint256 amount) internal {
        IERC20 u = s.underlying();
        deal(address(u), who, u.balanceOf(who) + amount);
        vm.startPrank(who);
        u.approve(address(s), amount);
        s.mint(amount, who);
        vm.stopPrank();
    }

    function _spot(address feed) internal view returns (uint256) {
        (, int256 answer,,,) = AggregatorV3Interface(feed).latestRoundData();
        return uint256(answer);
    }

    function _create(address stock, uint256 strike) internal returns (AarkaSeries) {
        return AarkaSeries(factory.createSeries(stock, strike, CLOSE_2OCT));
    }

    // ------------------------------------------------------------------ helpers: markets

    function _key(address a, address b, uint24 fee, int24 spacing, IHooks hooks_)
        internal
        pure
        returns (PoolKey memory)
    {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: fee,
            tickSpacing: spacing,
            hooks: hooks_
        });
    }

    /// @dev The live, hookless 0.30% pool for a stock. NVDA's holds ~$9.9m, TSLA's ~$14.8m.
    function _livePool(address stock) internal pure returns (PoolKey memory) {
        return _key(stock, USDG, 3000, 60, IHooks(address(0)));
    }

    function _mineHook(AarkaSeries s) internal returns (AarkaParityHook h) {
        bytes memory args = abi.encode(POOL_MANAGER, s, Currency.wrap(USDG), owner);
        (address expected, bytes32 salt) =
            HookMiner.find(address(this), HOOK_FLAGS, type(AarkaParityHook).creationCode, args);
        h = new AarkaParityHook{salt: salt}(POOL_MANAGER, s, Currency.wrap(USDG), owner);
        assertEq(address(h), expected);
    }

    /// @dev Opens a series' two hooked pools at prices that sum exactly to the live pool's price,
    ///      wires them, and seeds both with full-range liquidity minted from real stock.
    /// @param floorShareBps the floor's share of the underlying's price; the upside takes the rest
    /// @param halves how many of each half the LP puts in each pool
    function _openMarket(AarkaSeries s, uint256 floorShareBps, uint256 halves, uint256 maxArb)
        internal
        returns (Market memory m)
    {
        uint256 pUnder = _poolPrice(_livePool(address(s.underlying())), address(s.underlying()));
        uint256 pFloor = pUnder * floorShareBps / 10_000;
        return _openCustom(
            s,
            _livePool(address(s.underlying())),
            floorShareBps,
            _liquidityFor(halves, pFloor),
            _liquidityFor(halves, pUnder - pFloor),
            maxArb
        );
    }

    /// @dev The general form: any underlying pool, any liquidity in each hooked pool (0 for none).
    function _openCustom(
        AarkaSeries s,
        PoolKey memory underlyingKey,
        uint256 floorShareBps,
        int256 floorL,
        int256 upsideL,
        uint256 maxArb
    ) internal returns (Market memory m) {
        m.series = s;
        m.floor = s.floorToken();
        m.upside = s.upsideToken();
        m.hook = _mineHook(s);
        address stock = address(s.underlying());

        m.underlyingKey = underlyingKey;
        m.floorKey = _key(address(m.floor), USDG, 3000, 60, IHooks(address(m.hook)));
        m.upsideKey = _key(address(m.upside), USDG, 3000, 60, IHooks(address(m.hook)));

        uint256 pUnder = _poolPrice(underlyingKey, stock); // USDG units per whole share
        uint256 pFloor = pUnder * floorShareBps / 10_000;
        POOL_MANAGER.initialize(m.floorKey, _sqrtPrice(m.floorKey, address(m.floor), pFloor));
        POOL_MANAGER.initialize(m.upsideKey, _sqrtPrice(m.upsideKey, address(m.upside), pUnder - pFloor));

        vm.startPrank(owner);
        m.hook.wire(m.underlyingKey, m.floorKey, m.upsideKey);
        m.hook.setParams(100, maxArb);
        vm.stopPrank();

        // Enough halves for either pool, whatever its price.
        _mintPair(s, lp, 10_000e18);
        deal(USDG, lp, IERC20(USDG).balanceOf(lp) + 100_000_000e6);
        vm.startPrank(lp);
        m.floor.approve(address(liquidity), type(uint256).max);
        m.upside.approve(address(liquidity), type(uint256).max);
        IERC20(USDG).approve(address(liquidity), type(uint256).max);
        vm.stopPrank();
        if (floorL != 0) _addFullRange(m.floorKey, floorL);
        if (upsideL != 0) _addFullRange(m.upsideKey, upsideL);
    }

    /// @dev Full-range liquidity L that holds just under `halves` of the asset at `price`.
    ///      At full range the asset's reserve is L / sqrt(raw price), whichever side it is on, and
    ///      the raw price is price / 1e18 (USDG-wei per asset-wei), so sqrt(raw) = sqrt(price*1e18)/1e18.
    function _liquidityFor(uint256 halves, uint256 price) internal pure returns (int256) {
        return int256(halves * Math.sqrt(price * 1e18) / 1e18 * 99 / 100);
    }

    function _addFullRange(PoolKey memory key, int256 l) internal {
        vm.prank(lp);
        liquidity.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(key.tickSpacing),
                tickUpper: TickMath.maxUsableTick(key.tickSpacing),
                liquidityDelta: l,
                salt: 0
            }),
            ""
        );
    }

    /// @dev "One whole asset costs `quotePrice` USDG units" as sqrtPriceX96. The stock and the
    ///      halves are 18 decimals and USDG is 6, so the raw price is USDG-wei per asset-wei.
    function _sqrtPrice(PoolKey memory key, address asset, uint256 quotePrice) internal pure returns (uint160) {
        (uint256 num, uint256 den) =
            Currency.unwrap(key.currency0) == asset ? (quotePrice, uint256(1e18)) : (uint256(1e18), quotePrice);
        return uint160(Math.sqrt(FullMath.mulDiv(num, Q96 * Q96, den)));
    }

    /// @dev The asset's price in USDG units per whole asset, from the pool's slot0.
    function _poolPrice(PoolKey memory key, address asset) internal view returns (uint256) {
        (uint160 sqrtP,,,) = POOL_MANAGER.getSlot0(key.toId());
        uint256 x96;
        if (Currency.unwrap(key.currency0) == asset) {
            x96 = FullMath.mulDiv(sqrtP, sqrtP, Q96);
        } else {
            x96 = FullMath.mulDiv(FullMath.mulDiv(Q96, Q96, sqrtP), Q96, sqrtP);
        }
        return FullMath.mulDiv(x96, 1e18, Q96);
    }

    function _gapBps(Market memory m) internal view returns (uint256) {
        return hookLens.parity(m.hook).gapBps;
    }

    function _approveRouter(address who) internal {
        vm.startPrank(who);
        IERC20(NVDA).approve(address(router), type(uint256).max);
        IERC20(TSLA).approve(address(router), type(uint256).max);
        IERC20(USDG).approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _approveHalves(address who, Market memory m) internal {
        vm.startPrank(who);
        m.floor.approve(address(router), type(uint256).max);
        m.upside.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    /// @dev Router swap from `who`, selling exactly `amountIn` of `tokenIn` into `key`.
    function _sell(address who, PoolKey memory key, address tokenIn, uint256 amountIn) internal returns (uint256) {
        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;
        vm.prank(who);
        return router.swapExactIn(key, zeroForOne, amountIn, 0, who);
    }

    function _marketAddrs(Market memory m) internal pure returns (address[] memory a) {
        a = new address[](1);
        a[0] = address(m.hook);
    }
}
