// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {AarkaFactory} from "./AarkaFactory.sol";
import {AarkaSeries} from "./AarkaSeries.sol";
import {AggregatorV3Interface, IOraclePausable} from "./interfaces/IExternal.sol";

/// @title AarkaLens
/// @notice Read-only batching for front ends and indexers. Holds no state and touches nothing.
///
/// @dev Rendering one series card needs roughly a dozen `eth_call`s against the core contracts.
///      This turns that into one. It is deliberately outside the protocol: it can be redeployed,
///      replaced or ignored without any consequence for a deployed series, so nothing about the
///      security model depends on it.
///
///      The feed, the pause flag and token symbols are read inside try/catch, so a broken feed or
///      an odd token cannot make the whole page fail to load; those fields come back zeroed with
///      `priceValid` false. Reads from the series itself and from the underlying's `balanceOf` are
///      not wrapped, because every series is factory-deployed and every underlying is registered.
contract AarkaLens {
    enum Status {
        Open, // before expiry: mint, redeem
        Expired, // past expiry, awaiting settlement: redeem only
        Challenging, // settled, inside the challenge window: redeem only
        Claimable // settled and unlocked: redeem, claimFloor, claimUpside
    }

    struct SeriesView {
        address series;
        Status status;
        // terms
        address underlying;
        string underlyingSymbol;
        uint256 strike; // 8 decimals
        uint64 expiry;
        address feed;
        // the two halves
        address floorToken;
        string floorSymbol;
        address upsideToken;
        string upsideSymbol;
        // live oracle
        uint256 spotPrice; // 8 decimals
        uint256 spotUpdatedAt;
        bool priceValid;
        bool oraclePaused;
        // settlement
        bool settled;
        uint256 settlementPrice;
        uint256 floorPayoutPerUnit; // 18 decimals
        uint256 upsidePayoutPerUnit; // 18 decimals
        uint64 claimsUnlockAt;
        // size
        uint256 totalDeposited;
        uint256 halfSupply;
    }

    struct PositionView {
        address series;
        uint256 underlyingBalance;
        uint256 underlyingAllowance;
        uint256 floorBalance;
        uint256 upsideBalance;
        uint256 redeemable; // pairs the holder could return right now
        uint256 floorClaimable; // underlying owed if they claimed the floor leg now
        uint256 upsideClaimable;
    }

    AarkaFactory public immutable factory;

    constructor(AarkaFactory factory_) {
        factory = factory_;
    }

    // --------------------------------------------------------------------
    // Series
    // --------------------------------------------------------------------

    function seriesCount() external view returns (uint256) {
        return factory.seriesCount();
    }

    /// @notice Every series the factory has created.
    /// @dev Measured at roughly 40k gas per series, so this stops fitting a typical `eth_call`
    ///      somewhere past a thousand of them. Series creation is permissionless, so that list is
    ///      growable by anyone. Front ends should use `seriesPage` and treat this as a convenience
    ///      for small deployments.
    function allSeries() external view returns (SeriesView[] memory out) {
        uint256 n = factory.seriesCount();
        out = new SeriesView[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = view_(factory.allSeries(i));
        }
    }

    /// @notice A page of series, for when the list outgrows one call.
    function seriesPage(uint256 offset, uint256 limit) external view returns (SeriesView[] memory out) {
        uint256 n = factory.seriesCount();
        if (offset >= n) return new SeriesView[](0);
        uint256 end = offset + limit;
        if (end > n) end = n;
        out = new SeriesView[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            out[i - offset] = view_(factory.allSeries(i));
        }
    }

    /// @notice Only the series written on one underlying.
    function seriesByUnderlying(address underlying) external view returns (SeriesView[] memory out) {
        uint256 n = factory.seriesCount();
        SeriesView[] memory buf = new SeriesView[](n);
        uint256 k;
        for (uint256 i; i < n; ++i) {
            SeriesView memory v = view_(factory.allSeries(i));
            if (v.underlying == underlying) buf[k++] = v;
        }
        out = new SeriesView[](k);
        for (uint256 i; i < k; ++i) {
            out[i] = buf[i];
        }
    }

    function view_(address s) public view returns (SeriesView memory v) {
        AarkaSeries series = AarkaSeries(s);
        v.series = s;
        v.underlying = address(series.underlying());
        v.strike = series.strike();
        v.expiry = series.expiry();
        v.feed = address(series.feed());
        v.floorToken = address(series.floorToken());
        v.upsideToken = address(series.upsideToken());

        v.underlyingSymbol = _symbol(v.underlying);
        v.floorSymbol = _symbol(v.floorToken);
        v.upsideSymbol = _symbol(v.upsideToken);

        v.settled = series.settled();
        v.settlementPrice = series.settlementPrice();
        v.floorPayoutPerUnit = series.floorPayoutPerUnit();
        v.upsidePayoutPerUnit = series.upsidePayoutPerUnit();
        v.claimsUnlockAt = series.claimsUnlockAt();

        v.totalDeposited = IERC20(v.underlying).balanceOf(s);
        v.halfSupply = IERC20(v.floorToken).totalSupply();

        (v.spotPrice, v.spotUpdatedAt, v.priceValid) = _spot(v.feed);
        v.oraclePaused = _paused(v.underlying);
        v.status = _status(v.expiry, v.settled, v.claimsUnlockAt);
    }

    // --------------------------------------------------------------------
    // Positions
    // --------------------------------------------------------------------

    /// @notice One holder's position in every series, in a single call.
    function positionsOf(address holder) external view returns (PositionView[] memory out) {
        uint256 n = factory.seriesCount();
        out = new PositionView[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = positionIn(holder, factory.allSeries(i));
        }
    }

    /// @notice One holder's position in a page of series. The bounded form of `positionsOf`, for
    ///         the same reason `seriesPage` exists: anyone can grow the series list.
    function positionsPage(address holder, uint256 offset, uint256 limit)
        external
        view
        returns (PositionView[] memory out)
    {
        uint256 n = factory.seriesCount();
        if (offset >= n) return new PositionView[](0);
        uint256 end = offset + limit;
        if (end > n) end = n;
        out = new PositionView[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            out[i - offset] = positionIn(holder, factory.allSeries(i));
        }
    }

    function positionIn(address holder, address s) public view returns (PositionView memory p) {
        AarkaSeries series = AarkaSeries(s);
        IERC20 underlying = series.underlying();
        IERC20 floorToken = IERC20(address(series.floorToken()));
        IERC20 upsideToken = IERC20(address(series.upsideToken()));

        p.series = s;
        p.underlyingBalance = underlying.balanceOf(holder);
        p.underlyingAllowance = underlying.allowance(holder, s);
        p.floorBalance = floorToken.balanceOf(holder);
        p.upsideBalance = upsideToken.balanceOf(holder);
        p.redeemable = p.floorBalance < p.upsideBalance ? p.floorBalance : p.upsideBalance;

        if (series.settled()) {
            // Math.mulDiv, matching AarkaSeries exactly, so a quote can never disagree with the
            // settlement it is quoting.
            p.floorClaimable = Math.mulDiv(p.floorBalance, series.floorPayoutPerUnit(), 1e18);
            p.upsideClaimable = Math.mulDiv(p.upsideBalance, series.upsidePayoutPerUnit(), 1e18);
        }
    }

    // --------------------------------------------------------------------
    // Quotes
    // --------------------------------------------------------------------

    /// @notice What the two halves would pay if the series settled at `price` right now.
    /// @dev The same arithmetic AarkaSeries uses, exposed so a front end can draw the payoff
    ///      curve from the contract rather than reimplementing it in TypeScript and drifting.
    function payoutsAt(address s, uint256 price)
        external
        view
        returns (uint256 floorPayout, uint256 upsidePayout)
    {
        if (price == 0) return (0, 0);
        uint256 strike = AarkaSeries(s).strike();
        uint256 min = price < strike ? price : strike;
        floorPayout = Math.mulDiv(min, 1e18, price);
        upsidePayout = 1e18 - floorPayout;
    }

    // --------------------------------------------------------------------
    // Guarded external reads
    // --------------------------------------------------------------------

    function _status(uint64 expiry, bool settled, uint64 claimsUnlockAt) private view returns (Status) {
        if (!settled) return block.timestamp < expiry ? Status.Open : Status.Expired;
        return block.timestamp < claimsUnlockAt ? Status.Challenging : Status.Claimable;
    }

    function _spot(address feed) private view returns (uint256 price, uint256 updatedAt, bool valid) {
        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 at, uint80
        ) {
            if (answer > 0 && at != 0) return (uint256(answer), at, true);
        } catch {}
        return (0, 0, false);
    }

    function _paused(address token) private view returns (bool) {
        try IOraclePausable(token).oraclePaused() returns (bool p) {
            return p;
        } catch {
            return false;
        }
    }

    function _symbol(address token) private view returns (string memory) {
        try IERC20Metadata(token).symbol() returns (string memory s) {
            return s;
        } catch {
            return "";
        }
    }
}
