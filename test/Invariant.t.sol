// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BaseTest} from "./Base.t.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AarkaToken} from "../src/AarkaToken.sol";

/// @notice Drives a series through random mint / redeem / settle / challenge / claim orderings.
contract Handler is Test {
    AarkaSeries public series;
    AarkaToken public f;
    AarkaToken public u;
    address[] public actors;

    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;

    constructor(AarkaSeries s, address[] memory actors_) {
        series = s;
        f = s.floorToken();
        u = s.upsideToken();
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function mint(uint256 seed, uint256 amount) external {
        if (block.timestamp >= series.expiry()) return;
        address a = _actor(seed);
        amount = bound(amount, 1, 100e18);
        vm.startPrank(a);
        try series.mint(amount, a) {
            ghostDeposited += amount;
        } catch {}
        vm.stopPrank();
    }

    function redeem(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 max = Math.min(f.balanceOf(a), u.balanceOf(a));
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(a);
        try series.redeem(amount, a) {
            ghostWithdrawn += amount;
        } catch {}
    }

    /// @dev Move one half around so the two supplies can diverge, which is the case that makes
    ///      the solvency bound non-trivial.
    function transferHalf(uint256 seed, uint256 toSeed, uint256 amount, bool isFloor) external {
        address a = _actor(seed);
        address to = _actor(toSeed);
        AarkaToken t = isFloor ? f : u;
        uint256 bal = t.balanceOf(a);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(a);
        t.transfer(to, amount);
    }

    function settle(uint256 priceSeed) external {
        if (series.settled() || block.timestamp < series.expiry()) return;
        try series.settle(200) {} catch {}
        priceSeed; // rounds are pre-published by the test
    }

    function claimFloor(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 bal = f.balanceOf(a);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(a);
        try series.claimFloor(amount, a) returns (uint256 paid) {
            ghostWithdrawn += paid;
        } catch {}
    }

    function claimUpside(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 bal = u.balanceOf(a);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(a);
        try series.claimUpside(amount, a) returns (uint256 paid) {
            ghostWithdrawn += paid;
        } catch {}
    }

    function warp(uint256 delta) external {
        vm.warp(block.timestamp + bound(delta, 1 hours, 20 days));
    }
}

contract InvariantTest is BaseTest {
    Handler handler;

    function setUp() public override {
        super.setUp();

        // Pre-publish the settlement rounds so the handler can settle whenever it likes.
        feed.pushRound(200, 460e8, EXPIRY - 30 minutes);
        feed.pushRound(201, 500e8, EXPIRY + 10 minutes);

        address[] memory actors = new address[](3);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = makeAddr("carol");

        nvda.mint(actors[2], 1_000e18);
        for (uint256 i; i < actors.length; ++i) {
            vm.prank(actors[i]);
            nvda.approve(address(series), type(uint256).max);
        }

        handler = new Handler(series, actors);
        targetContract(address(handler));
    }

    /// @notice I1. Before settlement the two supplies and the vault balance move as one.
    function invariant_suppliesTrackTheBalanceBeforeSettlement() public view {
        if (series.settled()) return;
        assertEq(f.totalSupply(), u.totalSupply());
        assertEq(f.totalSupply(), nvda.balanceOf(address(series)));
    }

    /// @notice I2. The conservation identity, whenever it is defined.
    function invariant_payoutsSumToOne() public view {
        if (!series.settled()) return;
        assertEq(series.floorPayoutPerUnit() + series.upsidePayoutPerUnit(), ONE);
    }

    /// @notice I3 and I6. The vault can always pay every outstanding claim, under the worst
    ///         possible exit ordering.
    /// @dev The worst case is pair-redemption, which pays exactly 1 per pair, because claiming
    ///      the two halves separately floors twice and therefore pays at most that much. So the
    ///      maximum possible outflow is: redeem every pair, then claim what is left over.
    function invariant_vaultIsAlwaysSolvent() public view {
        uint256 fs = f.totalSupply();
        uint256 us = u.totalSupply();
        uint256 balance = nvda.balanceOf(address(series));

        uint256 required;
        if (!series.settled()) {
            required = Math.max(fs, us);
        } else {
            uint256 pairs = Math.min(fs, us);
            required = pairs + Math.mulDiv(fs - pairs, series.floorPayoutPerUnit(), ONE)
                + Math.mulDiv(us - pairs, series.upsidePayoutPerUnit(), ONE);
        }
        assertGe(balance, required, "vault cannot cover outstanding claims");
    }

    /// @notice Nothing is ever created. Total withdrawn never exceeds total deposited.
    function invariant_noValueIsCreated() public view {
        assertLe(handler.ghostWithdrawn(), handler.ghostDeposited());
    }

    /// @notice I7. The terms are immutable.
    function invariant_termsNeverChange() public view {
        assertEq(series.strike(), STRIKE);
        assertEq(series.expiry(), EXPIRY);
        assertEq(address(series.underlying()), address(nvda));
        assertEq(address(series.feed()), address(feed));
    }
}
