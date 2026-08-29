// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";

import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AarkaParityHook} from "../src/hook/AarkaParityHook.sol";
import {TestStockToken} from "../src/testnet/TestStockToken.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";

/// @notice Deploys the parity hook and the three pools it arbitrages, on Robinhood Chain testnet.
///
/// @dev Uniswap v4's PoolManager is already on testnet at the same address as mainnet, so nothing
///      needs to be stood up for it — only the quote asset, which testnet lacks.
///
///      The hook's permissions live in the low 14 bits of its own address, so the address is mined
///      with CREATE2 before deployment. The hook's constructor asserts the mining worked, which is
///      what stops a bad salt from silently producing a hook with the wrong permissions.
///
///      Pools are initialised at parity: P(floor) + P(upside) == P(underlying). Any swap after that
///      breaks it, and the hook closes it inside the same transaction.
///
///        forge script script/DeployHook.s.sol --rpc-url robinhood_testnet --broadcast \
///          --private-key $PRIVATE_KEY --sig "run(address,address)" <SERIES> <NVDA>
contract DeployHook is Script {
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    /// @notice The canonical deterministic deployer Foundry routes `new X{salt: ...}` through.
    /// @dev This, not msg.sender, is what must be passed to HookMiner. Inside a test the CREATE2
    ///      is performed by the test contract itself, so mining against `address(this)` works and
    ///      the mistake stays hidden; in a broadcast script it goes through this factory instead,
    ///      the mined address no longer matches, and the hook's constructor rejects it.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    uint256 constant Q96 = 1 << 96;
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    // Marks that satisfy the identity: 180 + 35 == 215.
    uint256 constant P_UNDER = 215e6;
    uint256 constant P_FLOOR = 180e6;
    uint256 constant P_UPSIDE = 35e6;

    uint128 constant LIQUIDITY = 1e17;

    // Held in storage rather than locals: the deployment touches enough contracts that keeping
    // it all in one stack frame overflows.
    IPoolManager manager = IPoolManager(POOL_MANAGER);
    AarkaSeries series;
    TestStockToken nvda;
    TestUSDG usdg;
    AarkaParityHook hook;
    PoolModifyLiquidityTest router;
    PoolKey underlyingKey;
    PoolKey floorKey;
    PoolKey upsideKey;

    function run(address seriesAddr, address nvdaAddr) external {
        series = AarkaSeries(seriesAddr);
        nvda = TestStockToken(nvdaAddr);

        vm.startBroadcast();
        _deploy(msg.sender);
        _initialisePools(nvdaAddr);
        _seed(msg.sender, nvdaAddr);
        vm.stopBroadcast();

        console.log("");
        console.log("=== Aarka parity hook, Robinhood Chain testnet ===");
        console.log("TestUSDG              ", address(usdg));
        console.log("AarkaParityHook       ", address(hook));
        console.log("  low 14 bits         ", uint160(address(hook)) & Hooks.ALL_HOOK_MASK);
        console.log("  AFTER_SWAP_FLAG     ", uint160(Hooks.AFTER_SWAP_FLAG));
        console.log("liquidity router      ", address(router));
        console.log("series                ", address(series));
    }

    /// @dev The hook's permissions live in the low 14 bits of its own address, so the address is
    ///      mined before deployment. The constructor asserts the mining worked, which is what stops
    ///      a bad salt from silently producing a hook with the wrong permissions.
    function _deploy(address deployer) private {
        usdg = new TestUSDG();
        router = new PoolModifyLiquidityTest(manager);

        bytes memory args = abi.encode(manager, series, Currency.wrap(address(usdg)), deployer);
        (address expected, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER, uint160(Hooks.AFTER_SWAP_FLAG), type(AarkaParityHook).creationCode, args
        );
        hook = new AarkaParityHook{salt: salt}(
            manager, series, Currency.wrap(address(usdg)), deployer
        );
        require(address(hook) == expected, "hook address mining failed");
    }

    /// @dev Pools open at parity: P(floor) + P(upside) == P(underlying). Any swap after that breaks
    ///      it and the hook closes it in the same transaction.
    ///
    ///      The underlying pool carries no hook, mirroring mainnet where NVDA/USDG already exists
    ///      and a hook cannot be attached to a live pool.
    function _initialisePools(address nvdaAddr) private {
        address floorToken = address(series.floorToken());
        address upsideToken = address(series.upsideToken());

        underlyingKey = _key(nvdaAddr, address(usdg), IHooks(address(0)));
        floorKey = _key(floorToken, address(usdg), IHooks(address(hook)));
        upsideKey = _key(upsideToken, address(usdg), IHooks(address(hook)));

        manager.initialize(underlyingKey, _sqrtPrice(underlyingKey, nvdaAddr, P_UNDER));
        manager.initialize(floorKey, _sqrtPrice(floorKey, floorToken, P_FLOOR));
        manager.initialize(upsideKey, _sqrtPrice(upsideKey, upsideToken, P_UPSIDE));

        hook.wire(underlyingKey, floorKey, upsideKey);
        hook.setParams(30, 100_000e18);
    }

    function _seed(address deployer, address nvdaAddr) private {
        nvda.mint(deployer, 500_000e18);
        usdg.mint(deployer, 500_000_000e6);
        IERC20(nvdaAddr).approve(address(series), type(uint256).max);
        series.mint(200_000e18, deployer);

        IERC20(nvdaAddr).approve(address(router), type(uint256).max);
        IERC20(address(usdg)).approve(address(router), type(uint256).max);
        IERC20(address(series.floorToken())).approve(address(router), type(uint256).max);
        IERC20(address(series.upsideToken())).approve(address(router), type(uint256).max);

        _addLiquidity(underlyingKey);
        _addLiquidity(floorKey);
        _addLiquidity(upsideKey);
    }

    function _key(address a, address b, IHooks hooks_) internal pure returns (PoolKey memory) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: hooks_
        });
    }

    /// @dev sqrtPriceX96 for "one whole asset costs `quotePrice` quote units". Assets are 18
    ///      decimals and the quote is 6, so the raw pool price is quote-wei per asset-wei.
    function _sqrtPrice(PoolKey memory key, address asset, uint256 quotePrice)
        internal
        pure
        returns (uint160)
    {
        (uint256 num, uint256 den) =
            Currency.unwrap(key.currency0) == asset ? (quotePrice, uint256(1e18)) : (uint256(1e18), quotePrice);
        return uint160(Math.sqrt(FullMath.mulDiv(num, Q96 * Q96, den)));
    }

    function _addLiquidity(PoolKey memory key) private {
        router.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(TICK_SPACING),
                tickUpper: TickMath.maxUsableTick(TICK_SPACING),
                liquidityDelta: int256(uint256(LIQUIDITY)),
                salt: 0
            }),
            ""
        );
    }
}
