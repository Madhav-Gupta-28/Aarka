// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DateLib} from "../src/libraries/DateLib.sol";

contract DateLibTest is Test {
    function test_knownDates() public pure {
        // 1970-01-01
        assertEq(DateLib.toTag(0), "01JAN70");
        // 2026-09-25 16:00 ET == 20:00 UTC (a Friday, a real expiry candidate)
        assertEq(DateLib.toTag(1790366400), "25SEP26");
        // leap day
        assertEq(DateLib.toTag(1709164800), "29FEB24");
        // day before and after a leap day
        assertEq(DateLib.toTag(1709078400), "28FEB24");
        assertEq(DateLib.toTag(1709251200), "01MAR24");
        // century boundary
        assertEq(DateLib.toTag(4102444800), "01JAN00");
    }

    function test_civilRoundTrip() public pure {
        (uint256 y, uint256 m, uint256 d) = DateLib.toCivil(1790366400);
        assertEq(y, 2026);
        assertEq(m, 9);
        assertEq(d, 25);
    }

    /// forge-config: default.fuzz.runs = 2000
    function testFuzz_neverReverts(uint32 ts) public pure {
        DateLib.toTag(uint256(ts));
    }
}
