// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./Base.t.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AarkaToken} from "../src/AarkaToken.sol";

contract AarkaSeriesTest is BaseTest {
    // ---------------------------------------------------------------- naming

    function test_tokenNamingIsDerivedOnChain() public view {
        assertEq(f.symbol(), "fNVDA-230-25SEP26");
        assertEq(u.symbol(), "uNVDA-230-25SEP26");
        assertEq(f.name(), "Aarka Floor NVDA 25SEP26 $230.00");
        assertEq(u.name(), "Aarka Upside NVDA 25SEP26 $230.00");
    }

    // ---------------------------------------------------------------- mint / redeem

    function test_mintSplitsOneIntoTwo() public {
        vm.prank(alice);
        series.mint(100e18, alice);

        assertEq(f.balanceOf(alice), 100e18);
        assertEq(u.balanceOf(alice), 100e18);
        assertEq(nvda.balanceOf(address(series)), 100e18);
    }

    function test_redeemReturnsTheUnderlying() public {
        vm.startPrank(alice);
        series.mint(100e18, alice);
        series.redeem(40e18, alice);
        vm.stopPrank();

        assertEq(f.balanceOf(alice), 60e18);
        assertEq(u.balanceOf(alice), 60e18);
        assertEq(nvda.balanceOf(address(series)), 60e18);
    }

    function test_mintRevertsAfterExpiry() public {
        vm.warp(EXPIRY);
        vm.prank(alice);
        vm.expectRevert(AarkaSeries.Expired.selector);
        series.mint(1e18, alice);
    }

    /// @dev I5. The escape hatch: redeem works in every reachable state, so a dead oracle
    ///      strands nothing.
    function test_redeemWorksAfterExpiryWithNoSettlement() public {
        vm.prank(alice);
        series.mint(100e18, alice);

        vm.warp(EXPIRY + 365 days);
        vm.prank(alice);
        series.redeem(100e18, alice);
        assertEq(nvda.balanceOf(alice), 1_000e18);
        assertFalse(series.settled());
    }

    function test_redeemWorksAfterSettlement() public {
        vm.prank(alice);
        series.mint(100e18, alice);
        _settleAt(250e8);

        vm.prank(alice);
        series.redeem(100e18, alice);
        assertEq(nvda.balanceOf(alice), 1_000e18);
    }

    // ---------------------------------------------------------------- payoff

    function test_payoffBelowStrike_allToFloor() public {
        _settleAt(200e8);
        assertEq(series.floorPayoutPerUnit(), ONE);
        assertEq(series.upsidePayoutPerUnit(), 0);
    }

    function test_payoffAtStrike_allToFloor() public {
        _settleAt(int256(STRIKE));
        assertEq(series.floorPayoutPerUnit(), ONE);
        assertEq(series.upsidePayoutPerUnit(), 0);
    }

    function test_payoffOneWeiAboveStrike() public {
        _settleAt(int256(STRIKE) + 1);
        assertLt(series.floorPayoutPerUnit(), ONE);
        assertGt(series.upsidePayoutPerUnit(), 0);
        assertEq(series.floorPayoutPerUnit() + series.upsidePayoutPerUnit(), ONE);
    }

    function test_payoffAboveStrike_splits() public {
        _settleAt(460e8); // 2x the strike
        assertEq(series.floorPayoutPerUnit(), ONE / 2);
        assertEq(series.upsidePayoutPerUnit(), ONE / 2);
    }

    /// @dev I2. The conservation identity, over the whole price domain.
    function testFuzz_payoutsAlwaysSumToOne(uint256 price) public {
        price = bound(price, 1, 1e18);
        _settleAt(int256(price));
        assertEq(series.floorPayoutPerUnit() + series.upsidePayoutPerUnit(), ONE);
        assertLe(series.floorPayoutPerUnit(), ONE);
    }

    // ---------------------------------------------------------------- claims

    function test_claimsPayTheRightSplit() public {
        vm.prank(alice);
        series.mint(100e18, alice); // alice holds both halves
        vm.prank(alice);
        u.transfer(bob, 100e18); // bob buys the upside

        _settleAt(460e8); // S = 2K, so each half is worth half a token

        vm.prank(alice);
        uint256 paidF = series.claimFloor(100e18, alice);
        vm.prank(bob);
        uint256 paidU = series.claimUpside(100e18, bob);

        assertEq(paidF, 50e18);
        assertEq(paidU, 50e18);
        assertEq(paidF + paidU, 100e18);
        assertEq(nvda.balanceOf(address(series)), 0);
    }

    function test_worthlessUpsideClaimDoesNotRevert() public {
        vm.prank(alice);
        series.mint(100e18, alice);
        _settleAt(200e8); // below the strike

        vm.prank(alice);
        uint256 paid = series.claimUpside(100e18, alice);
        assertEq(paid, 0);
        assertEq(u.balanceOf(alice), 0); // still burnable out of the wallet
    }

    function test_claimsAreLockedDuringTheChallengeWindow() public {
        vm.prank(alice);
        series.mint(100e18, alice);
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);
        series.settle(200);

        vm.prank(alice);
        vm.expectRevert(AarkaSeries.ClaimsLocked.selector);
        series.claimFloor(1e18, alice);
    }

    function test_redeemIsNotBlockedByTheChallengeWindow() public {
        vm.prank(alice);
        series.mint(100e18, alice);
        _publishSettlementRounds(250e8);
        vm.warp(EXPIRY + 1);
        series.settle(200);

        vm.prank(alice);
        series.redeem(100e18, alice); // holders of both halves never wait
    }
}
