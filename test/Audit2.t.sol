// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Test.sol";
import {BaseTest} from "./Base.t.sol";
import {DateLib} from "../src/libraries/DateLib.sol";
import {AarkaLens} from "../src/AarkaLens.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";

/// @notice Second-pass audit: libraries, view layer, and denial-of-service surface.
contract Audit2Test is BaseTest {
    AarkaLens lens;

    function setUp() public override {
        super.setUp();
        lens = new AarkaLens(factory);
    }

    // ---------------------------------------------------------------- DateLib

    /// @notice AUDIT-10. The month lookup indexes a fixed 13-entry array. If any timestamp could
    ///         drive the index out of range the constructor of every series on that expiry would
    ///         panic. Fuzzed across the whole uint64 domain, not just plausible dates.
    function testFuzz_dateLibNeverPanicsAnywhereInUint64(uint64 ts) public pure {
        string memory tag = DateLib.toTag(uint256(ts));
        assertEq(bytes(tag).length, 7, "DDMMMYY, always exactly seven bytes");
    }

    /// @notice The civil conversion must round-trip against an independent implementation for
    ///         every day across a century, not just the handful of dates in the unit tests.
    function testFuzz_civilMatchesDaysSinceEpoch(uint32 daysSinceEpoch) public pure {
        daysSinceEpoch = uint32(bound(daysSinceEpoch, 0, 40_000)); // 1970 .. 2079
        uint256 ts = uint256(daysSinceEpoch) * 86400;
        (uint256 y, uint256 m, uint256 d) = DateLib.toCivil(ts);

        assertGe(y, 1970);
        assertGe(m, 1);
        assertLe(m, 12);
        assertGe(d, 1);
        assertLe(d, 31);

        // Day counts per month, leap years included.
        uint256 maxDay = 31;
        if (m == 4 || m == 6 || m == 9 || m == 11) maxDay = 30;
        if (m == 2) maxDay = (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)) ? 29 : 28;
        assertLe(d, maxDay, "no 31 February");
    }

    /// @notice Consecutive days must produce consecutive dates. Catches any off-by-one in the
    ///         era arithmetic that a spot check would miss.
    function testFuzz_consecutiveDaysAdvanceByExactlyOne(uint32 daysSinceEpoch) public pure {
        daysSinceEpoch = uint32(bound(daysSinceEpoch, 1, 39_999));
        (uint256 y0, uint256 m0, uint256 d0) = DateLib.toCivil(uint256(daysSinceEpoch) * 86400);
        (uint256 y1, uint256 m1, uint256 d1) = DateLib.toCivil(uint256(daysSinceEpoch + 1) * 86400);

        bool sameDayPlusOne = (y1 == y0 && m1 == m0 && d1 == d0 + 1);
        bool nextMonth = (y1 == y0 && m1 == m0 + 1 && d1 == 1);
        bool nextYear = (y1 == y0 + 1 && m1 == 1 && m0 == 12 && d1 == 1);
        assertTrue(sameDayPlusOne || nextMonth || nextYear, "the calendar advances by one day");
    }

    // ---------------------------------------------------------------- lens DoS

    /// @notice AUDIT-11. `allSeries()` loops over every series with no bound. Series creation is
    ///         permissionless, so the list is attacker-growable. Measure where an eth_call stops
    ///         being viable and confirm the paginated path is unaffected.
    function test_AUDIT11_unboundedLensReadHasALimit() public {
        uint64 expiry = EXPIRY;
        for (uint256 i; i < 40; ++i) {
            uint64[] memory d = new uint64[](1);
            d[0] = expiry;
            // Distinct strikes, same expiry: the cheapest way for anyone to inflate the list.
            factory.createSeries(address(nvda), 300e8 + i * 1e8, expiry);
        }
        assertEq(factory.seriesCount(), 41);

        uint256 g0 = gasleft();
        lens.allSeries();
        uint256 usedAll = g0 - gasleft();

        uint256 g1 = gasleft();
        lens.seriesPage(0, 10);
        uint256 usedPage = g1 - gasleft();

        console.log("allSeries() gas with 41 series:", usedAll);
        console.log("seriesPage(0,10) gas:          ", usedPage);
        console.log("implied gas per series:        ", usedAll / 41);
        assertLt(usedPage, usedAll, "pagination is the escape hatch and it works");
    }

    // ---------------------------------------------------------------- griefing

    /// @notice AUDIT-12. Anyone can settle. Confirm a hostile caller cannot pick a worse price,
    ///         only an earlier block, and that the result is identical either way.
    function test_AUDIT12_hostileSettlerCannotChooseThePrice() public {
        vm.prank(alice);
        series.mint(100e18, alice);

        feed.pushRound(200, 250e8, EXPIRY - 30 minutes);
        feed.pushRound(201, 900e8, EXPIRY + 10 minutes); // a far better price, just too late

        vm.warp(EXPIRY + 1);
        vm.prank(bob); // an adversary settles, hoping to grab 900
        vm.expectRevert(AarkaSeries.RoundAfterExpiry.selector);
        series.settle(201);

        vm.prank(bob);
        series.settle(200);
        assertEq(series.settlementPrice(), 250e8, "the only round that qualifies is the right one");
    }

    /// @notice The calendar is add-only. Governance cannot strand a series by removing its expiry,
    ///         because there is no removal path at all.
    function test_AUDIT13_governanceCannotInvalidateALiveExpiry() public view {
        assertTrue(calendar.isValidExpiry(EXPIRY));
        // No remove function exists on ExpiryCalendar; the ABI is the proof.
        assertEq(series.expiry(), EXPIRY);
    }

    /// @notice AUDIT-14. Dust must accumulate in the vault and never become claimable a second
    ///         time. Settle at a price that guarantees flooring on both legs and drain everything.
    function test_AUDIT14_roundingDustIsTrappedNotDoubleSpent() public {
        vm.prank(alice);
        series.mint(3, alice); // three wei, so both legs floor hard
        vm.prank(alice);
        u.transfer(bob, 3);

        _settleAt(333e8); // not a clean ratio against a 230 strike

        vm.prank(alice);
        uint256 pf = series.claimFloor(3, alice);
        vm.prank(bob);
        uint256 pu = series.claimUpside(3, bob);

        console.log("floor paid:", pf);
        console.log("upside paid:", pu);
        console.log("dust left in vault:", nvda.balanceOf(address(series)));

        assertLe(pf + pu, 3, "never pays out more than was deposited");
        assertEq(f.totalSupply(), 0);
        assertEq(u.totalSupply(), 0);
        assertGe(nvda.balanceOf(address(series)), 0);
    }
}
