// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/src/libraries/SqrtPriceMath.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {AarkaSeries} from "../AarkaSeries.sol";

/// @title AarkaParityHook
/// @notice A Uniswap v4 hook that enforces `P(floor) + P(upside) == P(underlying)` by executing
///         the mint/redeem arbitrage inside `afterSwap` and donating the profit to the LPs.
///
/// @dev Why this is not another LVR hook.
///
///      Every arbitrage-capture hook built so far targets arbitrage against an *external*
///      reference price it can only estimate. It is guessing at fair value, so it recaptures a
///      fraction and carries the risk of guessing wrong.
///
///      Aarka does not guess. The vault defines the relationship: mint and redeem are exactly
///      1:1, unconditionally, at any price, with no fee. So the arbitrage is risk-free and
///      internal — there is no fair-value estimate anywhere in the trade, only an identity the
///      vault enforces by construction. That is a claim no hook arbitraging a CEX price can make.
///
///      Prior art, stated honestly: a v4 hook that detects and executes arbitrage inside
///      afterSwap is not new. The novelty claimed here is the application — identity-enforced
///      redemption arbitrage on a structured-product pair — not the pattern.
///
///      Three pools, all quoted in the same currency:
///
///          P1  underlying / quote     already liquid
///          P2  floor      / quote     created by Aarka
///          P3  upside     / quote     created by Aarka
///
///      sum too high  ->  buy underlying in P1, mint at the vault, sell both halves
///      sum too low   ->  buy both halves, redeem at the vault, sell underlying in P1
///
///      All of it inside the PoolManager's existing lock, so flash accounting means the hook
///      fronts no capital. It settles only the profit, and then donates that.
contract AarkaParityHook is IHooks, Ownable {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    uint256 private constant Q96 = 1 << 96;

    /// @notice The v4 permission bits this hook's address must carry, and nothing else.
    uint160 public constant PERMISSIONS =
        Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG;
    uint256 private constant BPS = 10_000;

    /// @dev Transient reentrancy flag. The hook trades the very pools it is installed on, so its
    ///      own swaps re-enter afterSwap. The flag makes that re-entry a no-op instead of an
    ///      infinite recursion, which is what lets the arb touch all three pools.
    bytes32 private constant REENTRANCY_SLOT = keccak256("aarka.parity.reentrancy");

    IPoolManager public immutable poolManager;
    AarkaSeries public immutable series;

    Currency public immutable quote;
    Currency public immutable underlyingCurrency;
    Currency public immutable floorCurrency;
    Currency public immutable upsideCurrency;

    PoolKey public underlyingKey;
    PoolKey public floorKey;
    PoolKey public upsideKey;
    bool public wired;

    /// @notice The pools this hook is willing to act for.
    /// @dev v4 pools are permissionless and any pool may name any hook, so `afterSwap` can be
    ///      triggered by a pool the hook has never heard of. Without this set, the profit would be
    ///      donated to whichever pool called — letting anyone stand up a pool nobody else uses,
    ///      point it here, and have Aarka's arbitrage revenue paid into it.
    mapping(PoolId => bool) public isWiredPool;

    /// @notice Binary-search steps used to solve for the parity-restoring trade size.
    /// @dev 20 halvings resolve the size to roughly one part in a million of the cap, which is far
    ///      finer than the fee tier. Each step is pure arithmetic on state read once up front, so
    ///      the whole solve costs no additional storage reads.
    uint256 private constant SOLVER_STEPS = 20;

    /// @dev A pool's state, read once, so the search runs entirely in memory.
    struct Leg {
        uint160 sqrtP;
        uint128 liquidity;
        bool assetIsZero;
    }

    /// @notice Minimum mispricing before the hook does anything, in basis points.
    /// @dev The gate that keeps ordinary swaps cheap. Below it, afterSwap costs three slot0 reads.
    uint256 public minDeviationBps = 30;

    /// @notice Hard cap on the size of a single arb, in units of the underlying.
    /// @dev Bounds the hook's exposure on the AMM legs. The vault leg cannot lose — it is 1:1 by
    ///      construction — so this cap plus revert-unless-profitable is what makes the hook
    ///      impossible to induce into a losing trade.
    uint256 public maxArbSize;

    /// @notice How long liquidity must stay in a hooked pool before it can be withdrawn.
    /// @dev The arbitrage profit is donated to the in-range liquidity of the pool that triggered
    ///      it. Without a hold, anyone can add liquidity, trigger the arb with a dust swap and pull
    ///      the liquidity out in the same transaction, taking the donation meant for the LPs who
    ///      stood there all along. An hour turns that risk-free round trip into an hour of real
    ///      exposure on a position the sniper would rather not hold (AUDIT-27).
    ///
    ///      The hold applies to every withdrawal from a pool that names this hook, including
    ///      zero-liquidity fee collection, which v4 routes through beforeRemoveLiquidity. It
    ///      restarts when a position is topped up.
    uint256 public constant MIN_LIQUIDITY_AGE = 1 hours;

    /// @notice When each position in a hooked pool last received liquidity.
    mapping(bytes32 positionKey => uint256 addedAt) public liquidityAddedAt;

    event Wired(PoolId underlyingPool, PoolId floorPool, PoolId upsidePool);
    event ParityRestored(bool minted, uint256 size, uint256 profit);
    event ParamsSet(uint256 minDeviationBps, uint256 maxArbSize);

    error NotPoolManager();
    error NotSelf();
    error InvalidHookAddress();
    error AlreadyWired();
    error NotWired();
    error PoolMismatch();
    error BelowThreshold();
    error NotProfitable();
    error HookNotImplemented();
    error NoProfitableSize();
    error UnknownPool();
    error UnexpectedDelta();
    error PoolNotInitialised();
    error LiquidityTooNew(uint256 withdrawableAt);

    constructor(IPoolManager poolManager_, AarkaSeries series_, Currency quote_, address owner_)
        Ownable(owner_)
    {
        // v4 reads a hook's permissions from the low 14 bits of its own address, so the deployment
        // address must be mined with CREATE2 to match. This asserts the mining actually worked.
        if (uint160(address(this)) & Hooks.ALL_HOOK_MASK != PERMISSIONS) {
            revert InvalidHookAddress();
        }

        poolManager = poolManager_;
        series = series_;
        quote = quote_;
        underlyingCurrency = Currency.wrap(address(series_.underlying()));
        floorCurrency = Currency.wrap(address(series_.floorToken()));
        upsideCurrency = Currency.wrap(address(series_.upsideToken()));
    }

    // --------------------------------------------------------------------
    // Wiring
    // --------------------------------------------------------------------

    /// @notice Bind the three pools. One-way: once wired, the keys can never change.
    function wire(PoolKey calldata underlyingKey_, PoolKey calldata floorKey_, PoolKey calldata upsideKey_)
        external
        onlyOwner
    {
        if (wired) revert AlreadyWired();
        _requirePair(underlyingKey_, underlyingCurrency);
        _requirePair(floorKey_, floorCurrency);
        _requirePair(upsideKey_, upsideCurrency);

        // The two halves' pools must carry this hook, or their swaps never reach afterSwap and the
        // pair is enforced by nothing. The underlying pool is the existing market and carries none.
        if (address(floorKey_.hooks) != address(this) || address(upsideKey_.hooks) != address(this)) {
            revert PoolMismatch();
        }
        // An uninitialised pool prices at zero, and every later arb would divide by it.
        _requireInitialised(underlyingKey_);
        _requireInitialised(floorKey_);
        _requireInitialised(upsideKey_);

        underlyingKey = underlyingKey_;
        floorKey = floorKey_;
        upsideKey = upsideKey_;
        isWiredPool[underlyingKey_.toId()] = true;
        isWiredPool[floorKey_.toId()] = true;
        isWiredPool[upsideKey_.toId()] = true;
        wired = true;

        emit Wired(underlyingKey_.toId(), floorKey_.toId(), upsideKey_.toId());
    }

    function setParams(uint256 minDeviationBps_, uint256 maxArbSize_) external onlyOwner {
        minDeviationBps = minDeviationBps_;
        maxArbSize = maxArbSize_;
        emit ParamsSet(minDeviationBps_, maxArbSize_);
    }

    function _requireInitialised(PoolKey calldata key) private view {
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        if (sqrtP == 0) revert PoolNotInitialised();
    }

    function _requirePair(PoolKey calldata key, Currency asset) private view {
        bool ok = (key.currency0 == asset && key.currency1 == quote)
            || (key.currency1 == asset && key.currency0 == quote);
        if (!ok) revert PoolMismatch();
    }

    // --------------------------------------------------------------------
    // The hook entry point
    // --------------------------------------------------------------------

    function afterSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        override
        returns (bytes4, int128)
    {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        // Our own arb swaps land back here. Returning immediately is what turns recursion into
        // a single pass, and it is why the arb is allowed to trade the pool it was triggered from.
        if (_reentrant() || !wired || maxArbSize == 0) return (IHooks.afterSwap.selector, 0);

        _setReentrant(true);
        // Self-call so a failed or unprofitable arb reverts in its own frame. Transient storage
        // and every currency delta unwind with it, leaving the user's swap untouched.
        try this.restoreParity(key) {} catch {}
        _setReentrant(false);

        return (IHooks.afterSwap.selector, 0);
    }

    // --------------------------------------------------------------------
    // The arbitrage
    // --------------------------------------------------------------------

    /// @notice External only so `afterSwap` can wrap it in try/catch. Callable by nobody else.
    function restoreParity(PoolKey calldata triggerKey) external {
        if (msg.sender != address(this)) revert NotSelf();

        // The pool that triggered this must be one of ours. Anyone can create a v4 pool naming
        // this hook, and the profit is paid to the triggering pool's LPs, so without this check
        // a pool the attacker solely provides is a free claim on the protocol's arbitrage.
        if (!isWiredPool[triggerKey.toId()]) revert UnknownPool();

        uint256 pUnder = _priceX96(underlyingKey, underlyingCurrency);
        uint256 pFloor = _priceX96(floorKey, floorCurrency);
        uint256 pUpside = _priceX96(upsideKey, upsideCurrency);

        // All three assets are 18 decimals against the same quote, so the decimal scaling is
        // identical across the three prices and cancels. Raw X96 prices compare directly.
        uint256 sum = pFloor + pUpside;
        bool halvesOverpriced = sum > pUnder;
        uint256 gap = halvesOverpriced ? sum - pUnder : pUnder - sum;
        if (FullMath.mulDiv(gap, BPS, pUnder) < minDeviationBps) revert BelowThreshold();

        uint256 size = _solveSize(halvesOverpriced);
        if (size == 0) revert NoProfitableSize();
        if (halvesOverpriced) _mintArb(size);
        else _redeemArb(size);

        uint256 profit = _profit();
        _donate(triggerKey, profit);

        // Every leg must have closed. An exact-output leg that ran out of reachable liquidity still
        // lets `take` pull the full size from the PoolManager's balance, which counts tokens held for
        // every pool and anything sent to it directly, so the hook can end here owing a half it never
        // paid for. Left alone that debt surfaces as CurrencyNotSettled at the end of the trader's
        // unlock, outside the try/catch, and reverts their swap. Reverting here instead unwinds the
        // arb and leaves the trade alone (AUDIT-28).
        _requireFlat(underlyingCurrency);
        _requireFlat(floorCurrency);
        _requireFlat(upsideCurrency);
        _requireFlat(quote);
        emit ParityRestored(halvesOverpriced, size, profit);
    }

    function _requireFlat(Currency c) private view {
        if (poolManager.currencyDelta(address(this), c) != 0) revert UnexpectedDelta();
    }

    /// @dev Halves are dear: buy the underlying, split it, sell both halves.
    function _mintArb(uint256 size) private {
        _swapExactOut(underlyingKey, underlyingCurrency, size);
        poolManager.take(underlyingCurrency, address(this), size);

        IERC20(Currency.unwrap(underlyingCurrency)).forceApprove(address(series), size);
        series.mint(size, address(this));

        _swapExactIn(floorKey, floorCurrency, size);
        _settleDebt(floorCurrency);
        _swapExactIn(upsideKey, upsideCurrency, size);
        _settleDebt(upsideCurrency);

        _settleDebtIfAny(underlyingCurrency);
    }

    /// @dev Halves are cheap: buy both, recombine them, sell the underlying.
    function _redeemArb(uint256 size) private {
        _swapExactOut(floorKey, floorCurrency, size);
        poolManager.take(floorCurrency, address(this), size);
        _swapExactOut(upsideKey, upsideCurrency, size);
        poolManager.take(upsideCurrency, address(this), size);

        series.redeem(size, address(this));

        _swapExactIn(underlyingKey, underlyingCurrency, size);
        _settleDebt(underlyingCurrency);
    }

    /// @dev The whole safety argument in one function. The vault leg is 1:1 and cannot lose, so
    ///      the only exposure is AMM slippage. Requiring a strictly positive quote balance at the
    ///      end means a manipulated pool cannot induce a losing trade — it can only make the arb
    ///      revert, which costs the hook nothing and leaves the user's swap alone.
    function _profit() private view returns (uint256) {
        int256 delta = poolManager.currencyDelta(address(this), quote);
        if (delta <= 0) revert NotProfitable();
        return uint256(delta);
    }

    /// @dev Pays the captured arbitrage to the in-range LPs of the pool that triggered it.
    function _donate(PoolKey calldata key, uint256 profit) private {
        if (key.currency0 == quote) poolManager.donate(key, profit, 0, "");
        else poolManager.donate(key, 0, profit, "");
    }

    // --------------------------------------------------------------------
    // Optimal sizing
    // --------------------------------------------------------------------

    /// @notice Solve for the trade size that restores parity, which is also the size that
    ///         maximises profit.
    ///
    /// @dev Profit for the mint direction is `R_f(s) + R_u(s) - C_N(s)`. Differentiating and
    ///      setting to zero gives
    ///
    ///          P_f(s) + P_u(s) = P_N(s)
    ///
    ///      which is the parity condition itself. So there is no separate optimisation to run:
    ///      the profit-maximising size *is* the parity-restoring size, and the problem reduces to
    ///      finding the root of a function that is monotone in `s`. Selling both halves pushes
    ///      their prices down while buying the underlying pushes its price up, so the gap shrinks
    ///      monotonically and a binary search converges.
    ///
    ///      The search returns the largest size at which the gap is still open, so it stops just
    ///      short of the root rather than past it. That is deliberate: fees make the true optimum
    ///      slightly smaller than the zero-gap point, and undersizing leaves value for the next
    ///      swap while oversizing loses money. The profitability check remains the backstop.
    ///
    ///      Liquidity is read once and treated as constant across the trade. That is exact for a
    ///      full-range position and a good approximation for a trade inside one tick range; a
    ///      trade that crosses initialised ticks will be sized slightly high, and the profit
    ///      check catches it.
    function _solveSize(bool minting) private view returns (uint256) {
        Leg memory n = _leg(underlyingKey, underlyingCurrency);
        Leg memory fl = _leg(floorKey, floorCurrency);
        Leg memory up = _leg(upsideKey, upsideCurrency);
        if (n.liquidity == 0 || fl.liquidity == 0 || up.liquidity == 0) return 0;

        // Cap the search so the exact-output legs can never ask a pool for more than it holds,
        // which would revert inside SqrtPriceMath rather than returning a price.
        uint256 hi = maxArbSize;
        if (minting) {
            hi = Math.min(hi, _maxOut(n, underlyingCurrency));
        } else {
            hi = Math.min(hi, Math.min(_maxOut(fl, floorCurrency), _maxOut(up, upsideCurrency)));
        }
        if (hi == 0) return 0;
        if (!_gapOpenAfter(n, fl, up, 1, minting)) return 0; // not even one wei is worth it

        uint256 lo = 1;
        for (uint256 i; i < SOLVER_STEPS; ++i) {
            if (hi - lo < 2) break;
            uint256 mid = lo + (hi - lo) / 2;
            if (_gapOpenAfter(n, fl, up, mid, minting)) lo = mid;
            else hi = mid;
        }
        return lo;
    }

    /// @dev True while trading `size` would still leave the mispricing pointing the same way.
    function _gapOpenAfter(Leg memory n, Leg memory fl, Leg memory up, uint256 size, bool minting)
        private
        pure
        returns (bool)
    {
        uint256 pN = _priceAfter(n, size, minting); // minting buys the underlying
        uint256 sum = _priceAfter(fl, size, !minting) + _priceAfter(up, size, !minting);
        return minting ? sum > pN : pN > sum;
    }

    /// @dev The pool's price after trading `amount` of the asset, without touching state.
    function _priceAfter(Leg memory leg, uint256 amount, bool buying) private pure returns (uint256) {
        bool zeroForOne = buying ? !leg.assetIsZero : leg.assetIsZero;
        uint160 next = buying
            ? SqrtPriceMath.getNextSqrtPriceFromOutput(leg.sqrtP, leg.liquidity, amount, zeroForOne)
            : SqrtPriceMath.getNextSqrtPriceFromInput(leg.sqrtP, leg.liquidity, amount, zeroForOne);
        return _toPriceX96(next, leg.assetIsZero);
    }

    /// @dev The most of `asset` this arb may ask for. Two ceilings, and the tighter one wins.
    ///
    ///      The curve: half of what the position virtually holds. Half rather than all, because
    ///      the price goes to infinity as the reserve is drained and the search must stay inside
    ///      the curve.
    ///
    ///      The balance: v4 settles a swap's input currency only after `afterSwap` returns, so
    ///      while this runs the tokens the trader is selling are still owed and the PoolManager
    ///      does not hold them yet. `take` moves real tokens, so an arb sized purely off the curve
    ///      can ask for more of a currency than is physically there. The ERC20 reverts, the
    ///      try/catch in `afterSwap` swallows it, and the pools are left mispriced by exactly the
    ///      swap that should have triggered the correction (AUDIT-24) — the hook going quiet as
    ///      the swap gets bigger, which is precisely backwards. Sizing against the real balance
    ///      turns that silent no-op into a smaller arb that still runs.
    function _maxOut(Leg memory leg, Currency asset) private view returns (uint256) {
        uint256 reserve = leg.assetIsZero
            ? FullMath.mulDiv(leg.liquidity, Q96, leg.sqrtP)
            : FullMath.mulDiv(leg.liquidity, leg.sqrtP, Q96);
        return Math.min(reserve / 2, IERC20(Currency.unwrap(asset)).balanceOf(address(poolManager)));
    }

    function _leg(PoolKey memory key, Currency asset) private view returns (Leg memory) {
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        return Leg({
            sqrtP: sqrtP,
            liquidity: poolManager.getLiquidity(key.toId()),
            assetIsZero: key.currency0 == asset
        });
    }

    // --------------------------------------------------------------------
    // v4 plumbing
    // --------------------------------------------------------------------

    function _swapExactOut(PoolKey memory key, Currency asset, uint256 amountOut) private {
        bool assetIsZero = key.currency0 == asset;
        bool zeroForOne = !assetIsZero; // pay quote, receive asset
        poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: int256(amountOut),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
    }

    function _swapExactIn(PoolKey memory key, Currency asset, uint256 amountIn) private {
        bool assetIsZero = key.currency0 == asset;
        bool zeroForOne = assetIsZero; // pay asset, receive quote
        poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
    }

    function _settleDebt(Currency c) private {
        int256 d = poolManager.currencyDelta(address(this), c);
        // Every call site reaches here holding a debt, but `uint256(-d)` on a credit would produce
        // an enormous number and try to transfer it. Assert the sign rather than rely on the
        // call order staying correct through future edits.
        if (d >= 0) revert UnexpectedDelta();
        uint256 owed = uint256(-d);
        poolManager.sync(c);
        IERC20(Currency.unwrap(c)).safeTransfer(address(poolManager), owed);
        poolManager.settle();
    }

    function _settleDebtIfAny(Currency c) private {
        if (poolManager.currencyDelta(address(this), c) < 0) _settleDebt(c);
    }

    function _priceX96(PoolKey memory key, Currency asset) private view returns (uint256) {
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        return _toPriceX96(sqrtP, key.currency0 == asset);
    }

    /// @dev The asset's price in quote terms, X96.
    ///
    ///      When the asset is currency1 the price has to be inverted, and the obvious way to do
    ///      that — form `p = sqrtP^2 / 2^96` and then compute `2^192 / p` — is wrong twice over.
    ///      `p` truncates to **zero** for any `sqrtP` below `2^48`, which is well inside the legal
    ///      range and panics on the division; and just above that threshold `p` is a single-digit
    ///      integer, so the inverse is quantised into enormous steps. Measured error at
    ///      `sqrtP = 5.48e14` was 21%.
    ///
    ///      A cheap asset is not a hypothetical here: a deep out-of-the-money upside token trades
    ///      near zero by design, which is precisely where the naive form breaks.
    ///
    ///      Dividing twice instead of squaring first keeps full precision and never forms the
    ///      degenerate intermediate. Both steps stay inside uint256 across the whole legal range.
    function _toPriceX96(uint160 sqrtP, bool assetIsZero) private pure returns (uint256) {
        if (assetIsZero) return FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96);
        uint256 half = FullMath.mulDiv(Q96, Q96, uint256(sqrtP));
        return FullMath.mulDiv(half, Q96, uint256(sqrtP));
    }

    function _reentrant() private view returns (bool r) {
        bytes32 slot = REENTRANCY_SLOT;
        assembly ("memory-safe") {
            r := tload(slot)
        }
    }

    function _setReentrant(bool v) private {
        bytes32 slot = REENTRANCY_SLOT;
        assembly ("memory-safe") {
            tstore(slot, v)
        }
    }

    // --------------------------------------------------------------------
    // Unused IHooks entry points
    // --------------------------------------------------------------------
    // v4 derives permissions from the hook's address, so with only the PERMISSIONS bits set these
    // are never called. They revert rather than returning a selector so a mis-mined address fails
    // loudly at the first swap instead of silently doing nothing.

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    // --------------------------------------------------------------------
    // Liquidity hold
    // --------------------------------------------------------------------

    function afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external returns (bytes4, BalanceDelta) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        liquidityAddedAt[_positionKey(sender, key, params)] = block.timestamp;
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata
    ) external view returns (bytes4) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        uint256 withdrawableAt = liquidityAddedAt[_positionKey(sender, key, params)] + MIN_LIQUIDITY_AGE;
        if (block.timestamp < withdrawableAt) revert LiquidityTooNew(withdrawableAt);
        return IHooks.beforeRemoveLiquidity.selector;
    }

    /// @dev The same identity v4 gives a position: owner, range and salt, scoped to the pool.
    function _positionKey(address sender, PoolKey calldata key, IPoolManager.ModifyLiquidityParams calldata params)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(key.toId(), sender, params.tickLower, params.tickUpper, params.salt));
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata)
        external
        pure
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }
}
