// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

import {AarkaFactory} from "../AarkaFactory.sol";
import {AarkaSeries} from "../AarkaSeries.sol";

/// @title AarkaRouter
/// @notice The product in one call: deposit a stock, keep one half, sell the other.
///
/// @dev Peripheral. It holds nothing between transactions, has no owner and no settings, and
///      nothing in the protocol depends on it — a series works the same whether anyone uses this
///      or not. It exists so a holder can do "keep the floor, sell the upside" with one approval
///      and one transaction instead of four, and so the site stops calling Uniswap's test router.
///
///      Every swap goes through the pool it is given, so a hooked pool behaves exactly as it does
///      for any other swapper: the parity hook sees the trade and restores the identity in the
///      same transaction. The router pays nothing for that and takes nothing from it.
///
///      Funds are only ever pulled from `msg.sender`. The unlock callback is reachable only from
///      the PoolManager, and the PoolManager only calls back the contract that unlocked it, so the
///      payer recorded in the callback data is always the caller who started the transaction.
contract AarkaRouter is IUnlockCallback, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    AarkaFactory public immutable factory;

    struct SwapData {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        address payer;
        address recipient;
    }

    event SplitAndSold(
        address indexed series, address indexed by, bool soldUpside, uint256 amount, uint256 quoteOut
    );
    event Swapped(address indexed by, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    error NotPoolManager();
    error NotASeries();
    error PoolDoesNotTradeThisHalf();
    error NativeCurrencyUnsupported();
    error InvalidAmount();
    error ZeroAddress();
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);

    constructor(IPoolManager poolManager_, AarkaFactory factory_) {
        poolManager = poolManager_;
        factory = factory_;
    }

    // --------------------------------------------------------------------
    // Split and sell
    // --------------------------------------------------------------------

    /// @notice Deposit `amount` of the series' stock, keep one half and sell the other into `key`.
    /// @param sellUpside true to keep the floor and sell the upside, false for the reverse
    /// @param key the pool trading the half being sold against a quote asset
    /// @param minQuoteOut the least quote the sale may return, or the whole call reverts
    /// @return quoteOut the quote asset sent to `to`
    function splitAndSell(
        AarkaSeries series,
        bool sellUpside,
        uint256 amount,
        PoolKey calldata key,
        uint256 minQuoteOut,
        address to
    ) external nonReentrant returns (uint256 quoteOut) {
        if (!factory.isSeries(address(series))) revert NotASeries();
        if (to == address(0)) revert ZeroAddress();
        _requireSwappable(amount);

        IERC20 sold = IERC20(address(sellUpside ? series.upsideToken() : series.floorToken()));
        bool soldIsZero = _requirePoolTrades(key, address(sold));

        uint256 halves = _depositAndSplit(series, amount);
        IERC20(address(sellUpside ? series.floorToken() : series.upsideToken())).safeTransfer(to, halves);

        quoteOut = _swap(key, soldIsZero, halves, address(this), to);
        if (quoteOut < minQuoteOut) revert InsufficientOutput(quoteOut, minQuoteOut);

        // A pool too thin to absorb the whole sale fills partially. The router holds nothing between
        // calls, so whatever it still holds of this half did not sell, and goes back to the caller.
        uint256 unsold = sold.balanceOf(address(this));
        if (unsold != 0) sold.safeTransfer(to, unsold);

        emit SplitAndSold(address(series), msg.sender, sellUpside, halves, quoteOut);
    }

    /// @dev Pulls the stock from the caller and splits it, returning how many of each half arrived.
    ///      Measured by balance rather than taken from `amount`, the same way the series measures
    ///      its own deposits.
    function _depositAndSplit(AarkaSeries series, uint256 amount) private returns (uint256 halves) {
        IERC20 stock = series.underlying();
        uint256 stockBefore = stock.balanceOf(address(this));
        stock.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = stock.balanceOf(address(this)) - stockBefore;

        IERC20 floor = IERC20(address(series.floorToken()));
        uint256 floorBefore = floor.balanceOf(address(this));
        stock.forceApprove(address(series), received);
        series.mint(received, address(this));
        halves = floor.balanceOf(address(this)) - floorBefore;
    }

    // --------------------------------------------------------------------
    // Plain swaps
    // --------------------------------------------------------------------

    /// @notice Sell exactly `amountIn` of one side of `key` for the other, paid from the caller.
    /// @dev Buying the upside with USDG, selling a floor you already hold, buying the stock: all of
    ///      it is this one call against the right pool.
    function swapExactIn(PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint256 minAmountOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (to == address(0)) revert ZeroAddress();
        _requireSwappable(amountIn);
        if (key.currency0.isAddressZero()) revert NativeCurrencyUnsupported();

        amountOut = _swap(key, zeroForOne, amountIn, msg.sender, to);
        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);

        (Currency cin, Currency cout) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        emit Swapped(msg.sender, Currency.unwrap(cin), Currency.unwrap(cout), amountIn, amountOut);
    }

    // --------------------------------------------------------------------
    // v4
    // --------------------------------------------------------------------

    function _swap(PoolKey memory key, bool zeroForOne, uint256 amountIn, address payer, address recipient)
        private
        returns (uint256 amountOut)
    {
        bytes memory result = poolManager.unlock(
            abi.encode(SwapData({key: key, zeroForOne: zeroForOne, amountIn: amountIn, payer: payer, recipient: recipient}))
        );
        amountOut = abi.decode(result, (uint256));
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        SwapData memory d = abi.decode(raw, (SwapData));

        BalanceDelta delta = poolManager.swap(
            d.key,
            IPoolManager.SwapParams({
                zeroForOne: d.zeroForOne,
                amountSpecified: -int256(d.amountIn),
                sqrtPriceLimitX96: d.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        (Currency cin, Currency cout) =
            d.zeroForOne ? (d.key.currency0, d.key.currency1) : (d.key.currency1, d.key.currency0);
        int128 paid = d.zeroForOne ? delta.amount0() : delta.amount1();
        int128 got = d.zeroForOne ? delta.amount1() : delta.amount0();

        // Exact input: the pool owes us `got` and we owe it `paid`, which is at most amountIn and
        // less only when the price limit cut the fill short.
        uint256 owed = uint256(uint128(-paid));
        poolManager.sync(cin);
        if (d.payer == address(this)) {
            IERC20(Currency.unwrap(cin)).safeTransfer(address(poolManager), owed);
        } else {
            IERC20(Currency.unwrap(cin)).safeTransferFrom(d.payer, address(poolManager), owed);
        }
        poolManager.settle();

        uint256 amountOut = uint256(uint128(got));
        poolManager.take(cout, d.recipient, amountOut);
        return abi.encode(amountOut);
    }

    function _requirePoolTrades(PoolKey calldata key, address half) private pure returns (bool halfIsZero) {
        if (key.currency0.isAddressZero()) revert NativeCurrencyUnsupported();
        halfIsZero = Currency.unwrap(key.currency0) == half;
        if (!halfIsZero && Currency.unwrap(key.currency1) != half) revert PoolDoesNotTradeThisHalf();
    }

    function _requireSwappable(uint256 amount) private pure {
        if (amount == 0 || amount > uint256(uint128(type(int128).max))) revert InvalidAmount();
    }
}
