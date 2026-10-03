// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HookBaseTest} from "./hook/HookBase.t.sol";
import {HookLens} from "../src/HookLens.sol";
import {AarkaParityHook} from "../src/hook/AarkaParityHook.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

/// @notice HookLens is what the site's parity panel reads. It had no tests (AUDIT-22).
contract HookLensTest is HookBaseTest {
    HookLens lens;

    function setUp() public override {
        super.setUp();
        lens = new HookLens(IPoolManager(address(manager)));
    }

    function test_readsThreePoolsAtParity() public view {
        HookLens.Parity memory p = lens.parity(hook);
        assertTrue(p.wired);
        assertEq(p.hook, address(hook));
        assertEq(p.series, address(series));
        assertEq(p.quote, address(usdg));
        // Prices come back in quote units per whole asset, within a wei of the opening marks.
        assertApproxEqAbs(p.underlyingPrice, P_UNDER, 1);
        assertApproxEqAbs(p.floorPrice, P_FLOOR, 1);
        assertApproxEqAbs(p.upsidePrice, P_UPSIDE, 1);
        assertApproxEqAbs(p.sumOfHalves, P_UNDER, 2);
        assertEq(p.gapBps, 0);
        assertEq(p.minDeviationBps, 30);
        assertEq(p.maxArbSize, 100_000e18);
        assertGt(p.floorLiquidity, 0);
    }

    /// @notice A swap in the stock pool has no hook to heal it, so the lens must report the gap
    ///         and which way it points.
    function test_reportsAGapAndItsDirection() public {
        _swap(underlyingKey, Currency.unwrap(underlyingKey.currency0) == address(nvda), -int256(uint256(2_000e18)));
        HookLens.Parity memory p = lens.parity(hook);
        assertGt(p.gapBps, 30);
        assertTrue(p.halvesDear, "stock sold down, so the halves are dear against it");
        assertEq(p.gapBps, parityGapBps(), "agrees with the test harness's own calculation");
    }

    function test_anUnwiredHookReturnsEarly() public {
        AarkaParityHook fresh = _mineAndDeploy();
        HookLens.Parity memory p = lens.parity(fresh);
        assertFalse(p.wired);
        assertEq(p.underlyingPrice, 0);
        assertEq(p.series, address(series));
    }
}
