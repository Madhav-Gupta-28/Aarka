// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @notice Second-pass audit of the hook's price arithmetic, isolated from pool machinery.
contract SolverAuditTest is Test {
    uint256 constant Q96 = 1 << 96;

    /// @dev The shape currently in AarkaParityHook.
    function _priceLossy(uint160 sqrtP, bool assetIsZero) internal pure returns (uint256) {
        uint256 p = FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96);
        return assetIsZero ? p : FullMath.mulDiv(Q96, Q96, p);
    }

    /// @dev The proposed replacement: invert without ever forming the lossy intermediate.
    function _priceSafe(uint160 sqrtP, bool assetIsZero) internal pure returns (uint256) {
        if (assetIsZero) return FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96);
        uint256 a = FullMath.mulDiv(Q96, Q96, uint256(sqrtP));
        return FullMath.mulDiv(a, Q96, uint256(sqrtP));
    }

    /// @notice AUDIT-09. `p = sqrtP^2 / 2^96` truncates to zero for any sqrtP below 2^48, and the
    ///         inversion branch then divides by it. A pool whose asset has been pushed very cheap
    ///         — a deep out-of-the-money upside token is the obvious case — panics the hook.
    function test_AUDIT09_priceInversionPanicsOnACheapAsset() public {
        uint160 sqrtP = uint160(2 ** 47); // comfortably inside the live range
        assertEq(FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96), 0, "intermediate is zero");

        vm.expectRevert(); // panic: division by zero
        this.callLossy(sqrtP);

        // The replacement returns a real number for the same input.
        assertGt(_priceSafe(sqrtP, false), 0, "the two-step inversion survives");
    }

    function callLossy(uint160 sqrtP) external pure returns (uint256) {
        return _priceLossy(sqrtP, false);
    }

    /// @notice Correctness, not agreement. A price and its inverse must multiply back to 2^192,
    ///         and that is the property the lossy form destroys.
    function testFuzz_theInverseIsActuallyTheInverse(uint160 sqrtP) public pure {
        // Bounded where the forward price itself is well resolved: below 2^56 the X96 forward
        // price is a small integer and its own truncation dominates, which is a property of the
        // representation rather than of the inversion.
        sqrtP = uint160(bound(sqrtP, uint256(2 ** 56), uint256(2 ** 120)));
        uint256 p0 = _priceSafe(sqrtP, true);
        uint256 p1 = _priceSafe(sqrtP, false);
        if (p0 == 0 || p1 == 0) return;

        uint256 product = FullMath.mulDiv(p0, p1, Q96);
        uint256 diff = product > Q96 ? product - Q96 : Q96 - product;
        assertLe(FullMath.mulDiv(diff, 10_000, Q96), 1, "safe form inverts to within a basis point");
    }

    /// @notice The same check against the lossy form, showing it does not hold. This is the
    ///         defect, expressed as a property rather than a single counterexample.
    function test_AUDIT09b_lossyFormIsQuantisedIntoGarbage() public pure {
        uint160 sqrtP = 548394833893341; // just above the panic threshold
        uint256 lossy = _priceLossy(sqrtP, false);
        uint256 safe = _priceSafe(sqrtP, false);

        uint256 diff = lossy > safe ? lossy - safe : safe - lossy;
        uint256 errorBps = FullMath.mulDiv(diff, 10_000, safe);
        console.log("relative error of the lossy inversion (bps):", errorBps);
        assertGt(errorBps, 1000, "the old form was more than 10% wrong here");
    }

    /// @notice And it must never panic anywhere in the legal range.
    function testFuzz_safeFormNeverRevertsInRange(uint160 sqrtP) public pure {
        sqrtP = uint160(bound(sqrtP, uint256(TickMath.MIN_SQRT_PRICE), uint256(TickMath.MAX_SQRT_PRICE - 1)));
        _priceSafe(sqrtP, false);
        _priceSafe(sqrtP, true);
    }
}
