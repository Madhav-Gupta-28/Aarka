// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";

import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";

/// @notice Testnet only. Moves a stock's hookless stock/USDG pool to the price its feed reports,
///         then nudges each market on that stock with a one-dollar floor buy so its parity hook
///         re-prices the halves against the new stock price.
///
/// @dev On mainnet arbitrageurs hold the stock pool to the market; measured on a fork, the live
///      NVDA/USDG pool sat within 0.1% of Chainlink. On testnet nobody trades the stock pool, so
///      it drifts from the mirrored feed and the site shows a share at one price and its two
///      halves summing to another. This plays the arbitrageur.
///
///      forge script script/Realign.s.sol --rpc-url $RPC_TESTNET --broadcast --private-key $PRIVATE_KEY \
///        --gas-estimate-multiplier 200 --sig "run(address,address,address[],address[])" \
///        <STOCK> <FEED> "[<SERIES>,...]" "[<HOOK>,...]"
contract Realign is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager constant MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    PoolSwapTest constant SWAPPER = PoolSwapTest(0x83b5D54866A826426f4E413b668B587c052Ab824);
    address constant USDG = 0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097;
    uint256 constant Q96 = 1 << 96;

    function run(address stock, address feed, address[] calldata series, address[] calldata hooks) external {
        require(series.length == hooks.length, "one hook per series");
        (, int256 answer,,,) = AggregatorV3Interface(feed).latestRoundData();
        uint256 target = uint256(answer) / 100; // 8-decimal dollars to 6-decimal USDG units

        vm.startBroadcast();
        IStockMint(stock).mint(msg.sender, 100_000e18);
        IStockMint(USDG).mint(msg.sender, 100_000_000e6);
        IERC20(stock).approve(address(SWAPPER), type(uint256).max);
        IERC20(USDG).approve(address(SWAPPER), type(uint256).max);

        PoolKey memory under = _key(stock, IHooks(address(0)));
        uint160 to = _sqrtPrice(under, stock, target);
        (uint160 from,,,) = MANAGER.getSlot0(under.toId());
        if (from != to) _swapTo(under, to);

        for (uint256 i; i < series.length; ++i) {
            address fl = address(AarkaSeries(series[i]).floorToken());
            PoolKey memory fk = _key(fl, IHooks(hooks[i]));
            bool usdgIsZero = Currency.unwrap(fk.currency0) == USDG;
            SWAPPER.swap(
                fk,
                IPoolManager.SwapParams({
                    zeroForOne: usdgIsZero,
                    amountSpecified: -1e6,
                    sqrtPriceLimitX96: usdgIsZero ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ""
            );
        }
        vm.stopBroadcast();
        console.log("stock pool moved to", target, "USDG units per share");
    }

    /// @notice Moves a stock's hookless stock/USDG pool to `price` (6-decimal USDG per share) and
    ///         nothing else. A trade in a hookless pool reaches no hook, so no market is touched.
    function moveTo(address stock, uint256 price) external {
        vm.startBroadcast();
        IStockMint(stock).mint(msg.sender, 100_000e18);
        IStockMint(USDG).mint(msg.sender, 100_000_000e6);
        IERC20(stock).approve(address(SWAPPER), type(uint256).max);
        IERC20(USDG).approve(address(SWAPPER), type(uint256).max);
        PoolKey memory under = _key(stock, IHooks(address(0)));
        _swapTo(under, _sqrtPrice(under, stock, price));
        vm.stopBroadcast();
        console.log("stock pool moved to", price, "USDG units per share");
    }

    function _swapTo(PoolKey memory key, uint160 target) private {
        (uint160 current,,,) = MANAGER.getSlot0(key.toId());
        bool zeroForOne = target < current;
        SWAPPER.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(1e30), sqrtPriceLimitX96: target}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function _key(address asset, IHooks hooks_) private pure returns (PoolKey memory) {
        (address c0, address c1) = asset < USDG ? (asset, USDG) : (USDG, asset);
        return PoolKey({currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: hooks_});
    }

    function _sqrtPrice(PoolKey memory key, address asset, uint256 quotePrice) private pure returns (uint160) {
        (uint256 num, uint256 den) =
            Currency.unwrap(key.currency0) == asset ? (quotePrice, uint256(1e18)) : (uint256(1e18), quotePrice);
        return uint160(Math.sqrt(FullMath.mulDiv(num, Q96 * Q96, den)));
    }
}

interface IStockMint {
    function mint(address to, uint256 amount) external;
}
