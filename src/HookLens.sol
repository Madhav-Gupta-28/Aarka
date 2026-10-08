// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";

import {AarkaSeries} from "./AarkaSeries.sol";
import {AarkaParityHook} from "./hook/AarkaParityHook.sol";

/// @title HookLens
/// @notice Read-only view of the three pools the parity hook watches.
/// @dev Turns what would be nine storage reads and a pile of fixed-point maths in the browser into
///      one `eth_call`. Holds no state and is outside the protocol, like AarkaLens.
contract HookLens {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 private constant Q96 = 1 << 96;

    struct Parity {
        address hook;
        address series;
        address quote;
        // prices scaled to quote units per whole asset (6 decimals for USDG)
        uint256 underlyingPrice;
        uint256 floorPrice;
        uint256 upsidePrice;
        uint256 sumOfHalves;
        uint256 gapBps; // absolute deviation of the sum from the underlying
        bool halvesDear; // true when the halves are expensive and the arb mints
        uint128 underlyingLiquidity;
        uint128 floorLiquidity;
        uint128 upsideLiquidity;
        uint256 minDeviationBps;
        uint256 maxArbSize;
        bool wired;
    }

    IPoolManager public immutable poolManager;

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    function parity(AarkaParityHook hook) external view returns (Parity memory p) {
        p.hook = address(hook);
        p.series = address(hook.series());
        p.quote = Currency.unwrap(hook.quote());
        p.wired = hook.wired();
        p.minDeviationBps = hook.minDeviationBps();
        p.maxArbSize = hook.maxArbSize();
        if (!p.wired) return p;

        AarkaSeries s = AarkaSeries(p.series);
        address under = address(s.underlying());
        address fl = address(s.floorToken());
        address up = address(s.upsideToken());

        // The keys the hook was wired with, never rebuilt. The underlying pool can be any fee tier
        // the owner chose; assuming the 0.30% one showed a hook wired to NVDA's deeper 0.01% pool
        // against prices it never trades (AUDIT-31). `wire` refuses an uninitialised pool, so every
        // price read below is of a live one.
        PoolKey memory kUnder = _wiredKey(hook, 0);
        PoolKey memory kFloor = _wiredKey(hook, 1);
        PoolKey memory kUpside = _wiredKey(hook, 2);

        p.underlyingLiquidity = poolManager.getLiquidity(kUnder.toId());
        p.floorLiquidity = poolManager.getLiquidity(kFloor.toId());
        p.upsideLiquidity = poolManager.getLiquidity(kUpside.toId());

        uint256 pn = _priceX96(kUnder, under);
        uint256 pf = _priceX96(kFloor, fl);
        uint256 pu = _priceX96(kUpside, up);

        uint256 sum = pf + pu;
        p.halvesDear = sum > pn;
        uint256 gap = p.halvesDear ? sum - pn : pn - sum;
        p.gapBps = FullMath.mulDiv(gap, 10_000, pn);

        // X96 price is quote-wei per asset-wei; assets are 18 decimals, so scale to whole units.
        p.underlyingPrice = FullMath.mulDiv(pn, 1e18, Q96);
        p.floorPrice = FullMath.mulDiv(pf, 1e18, Q96);
        p.upsidePrice = FullMath.mulDiv(pu, 1e18, Q96);
        p.sumOfHalves = p.floorPrice + p.upsidePrice;
    }

    /// @dev Divides twice rather than squaring first. Forming `sqrtP^2 / 2^96` truncates to zero
    ///      below sqrtP = 2^48 and quantises badly just above it, which matters here because a
    ///      deep out-of-the-money upside token trades in exactly that range.
    function _priceX96(PoolKey memory key, address asset) private view returns (uint256) {
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        if (Currency.unwrap(key.currency0) == asset) {
            return FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96);
        }
        uint256 half = FullMath.mulDiv(Q96, Q96, uint256(sqrtP));
        return FullMath.mulDiv(half, Q96, uint256(sqrtP));
    }

    /// @dev One of the hook's stored pool keys: 0 underlying, 1 floor, 2 upside.
    function _wiredKey(AarkaParityHook hook, uint256 which) private view returns (PoolKey memory k) {
        (Currency c0, Currency c1, uint24 fee, int24 spacing, IHooks hooks_) =
            which == 0 ? hook.underlyingKey() : which == 1 ? hook.floorKey() : hook.upsideKey();
        k = PoolKey({currency0: c0, currency1: c1, fee: fee, tickSpacing: spacing, hooks: hooks_});
    }
}
