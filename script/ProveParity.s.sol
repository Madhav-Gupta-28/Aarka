// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";

import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AarkaParityHook} from "../src/hook/AarkaParityHook.sol";

/// @notice Breaks parity with a real swap and shows the hook closing it in the same transaction.
///
///         forge script script/ProveParity.s.sol --rpc-url robinhood_testnet --broadcast \
///           --private-key $PK --gas-limit 900000000 \
///           --sig "run(address,address,address,uint256)" <HOOK> <ROUTER> <NVDA> <QUOTE_IN>
contract ProveParity is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager constant MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    uint256 constant Q96 = 1 << 96;

    AarkaParityHook hook;
    address nvda;
    address floorToken;
    address upsideToken;
    address quote;
    PoolKey underlyingKey;
    PoolKey floorKey;
    PoolKey upsideKey;

    function run(address hookAddr, address router, address nvdaAddr, uint256 quoteIn) external {
        hook = AarkaParityHook(hookAddr);
        nvda = nvdaAddr;
        quote = Currency.unwrap(hook.quote());
        AarkaSeries series = AarkaSeries(address(hook.series()));
        floorToken = address(series.floorToken());
        upsideToken = address(series.upsideToken());

        underlyingKey = _key(nvda, quote, IHooks(address(0)));
        floorKey = _key(floorToken, quote, IHooks(hookAddr));
        upsideKey = _key(upsideToken, quote, IHooks(hookAddr));

        console.log("--- before ---");
        _report();
        uint256 before = _gapBps();

        vm.startBroadcast();
        IERC20(quote).approve(router, type(uint256).max);
        bool zeroForOne = Currency.unwrap(floorKey.currency0) == quote;
        PoolSwapTest(router).swap(
            floorKey,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(quoteIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopBroadcast();

        console.log("");
        console.log("--- after a swap the hook was allowed to react to ---");
        _report();
        console.log("");
        console.log("parity gap before (bps):", before);
        console.log("parity gap after  (bps):", _gapBps());
    }

    function _report() private view {
        console.log("  P(underlying) x1e6:", _price6(underlyingKey, nvda));
        console.log("  P(floor)      x1e6:", _price6(floorKey, floorToken));
        console.log("  P(upside)     x1e6:", _price6(upsideKey, upsideToken));
        console.log("  sum of halves x1e6:", _price6(floorKey, floorToken) + _price6(upsideKey, upsideToken));
    }

    function _priceX96(PoolKey memory key, address asset) private view returns (uint256) {
        (uint160 sqrtP,,,) = MANAGER.getSlot0(key.toId());
        uint256 p = FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96);
        return Currency.unwrap(key.currency0) == asset ? p : FullMath.mulDiv(Q96, Q96, p);
    }

    /// @dev The raw X96 price is quote-wei per asset-wei. Scale by 1e18 to read as quote units
    ///      per whole asset, which for a 6-decimal quote means 215000000 == $215.00.
    function _price6(PoolKey memory key, address asset) private view returns (uint256) {
        return FullMath.mulDiv(_priceX96(key, asset), 1e18, Q96);
    }

    function _gapBps() private view returns (uint256) {
        uint256 pN = _priceX96(underlyingKey, nvda);
        uint256 sum = _priceX96(floorKey, floorToken) + _priceX96(upsideKey, upsideToken);
        uint256 gap = sum > pN ? sum - pN : pN - sum;
        return FullMath.mulDiv(gap, 10_000, pN);
    }

    function _key(address a, address b, IHooks h) private pure returns (PoolKey memory) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000,
            tickSpacing: 60,
            hooks: h
        });
    }
}
