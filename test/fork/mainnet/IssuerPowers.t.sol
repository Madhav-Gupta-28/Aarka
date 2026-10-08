// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MainnetBase} from "./MainnetBase.t.sol";
import {AarkaSeries} from "../../../src/AarkaSeries.sol";

/// @notice What the stock issuer can do to an Aarka vault, using the issuer's real role holders on
///         Robinhood Chain mainnet.
///
/// @dev Aarka has no admin over user funds. The stock token does. Every NVDA, TSLA and other
///      Robinhood stock token sits behind one upgradeable beacon whose access registry grants:
///
///        adminBurn      burn tokens from ANY address        0x957B…74D4
///        blockAccounts  block an address from transferring  0x913c…28fD
///        pause          stop every transfer of the token    0xFCcF…Ab23
///        pauseOracle    flag the price as unusable          0x7369…4Abc
///        updateMultiplier  schedule a corporate action      0x9290…8143
///        upgradeTo      replace the token's code            (registry admin)
///
///      These are the issuer's legal-compliance powers over a regulated security, and Aarka cannot
///      remove them. These tests record exactly what each does to a series, so the trust
///      assumption is measured rather than asserted.
contract MainnetIssuerPowersTest is MainnetBase {
    AarkaSeries nv;

    function setUp() public {
        _forkA();
        nv = _create(NVDA, 230e8);
        _mintPair(nv, alice, 10e18);
        _mintPair(nv, bob, 10e18);
    }

    /// @notice The issuer can burn stock out of the vault itself. Pairs are then backed by less
    ///         than one share each, and whoever exits last cannot exit.
    function test_ISSUER_adminBurnFromTheVaultBreaksTheOneToOneBacking() public {
        vm.prank(ISSUER_BURNER);
        IStock(NVDA).adminBurn(address(nv), 5e18);
        assertEq(IERC20(NVDA).balanceOf(address(nv)), 15e18, "20 pairs, 15 shares");

        vm.prank(alice);
        nv.redeem(10e18, alice); // first out is whole
        vm.prank(bob);
        vm.expectRevert(); // ERC20InsufficientBalance from the real token
        nv.redeem(10e18, bob);
        vm.prank(bob);
        nv.redeem(5e18, bob); // bob can recover only what is left
        assertEq(nv.floorToken().balanceOf(bob), 5e18, "and holds 5 pairs nothing backs");
    }

    /// @notice A blocklisted vault can neither take deposits nor pay anyone out.
    function test_ISSUER_blockingTheVaultFreezesIt() public {
        vm.prank(ISSUER_BLOCKLISTER);
        IRegistry(STOCK_REGISTRY).blockAccounts(_one(address(nv)));
        assertTrue(IRegistry(STOCK_REGISTRY).isBlocked(address(nv)));

        vm.prank(alice);
        vm.expectRevert();
        nv.redeem(1e18, alice);

        // The real token refuses even an approval naming a blocked address, so no deposit can start.
        vm.prank(bob);
        vm.expectRevert();
        IERC20(NVDA).approve(address(nv), 1e18);
    }

    /// @notice A blocklisted holder cannot receive their payout, but can name another address:
    ///         every exit takes a `to`.
    function test_ISSUER_aBlockedHolderCanStillDirectThePayoutElsewhere() public {
        vm.prank(ISSUER_BLOCKLISTER);
        IRegistry(STOCK_REGISTRY).blockAccounts(_one(alice));
        vm.prank(alice);
        vm.expectRevert();
        nv.redeem(1e18, alice);
        vm.prank(alice);
        nv.redeem(1e18, bob);
        assertEq(IERC20(NVDA).balanceOf(bob), 1e18);
    }

    /// @notice A token-wide pause stops every exit, and settlement, which moves no tokens, still runs.
    function test_ISSUER_aTokenPauseStopsExitsButNotSettlement() public {
        vm.prank(ISSUER_TOKEN_PAUSER);
        IStock(NVDA).pause();

        vm.prank(alice);
        vm.expectRevert();
        nv.redeem(1e18, alice);

        _toBlockB();
        _sequencerUpPastGrace();
        nv.settle(NVDA_CLOSE_ROUND);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        vm.expectRevert();
        nv.claimFloor(1e18, alice);
        console.log("paused token: settled at %s, claims wait for the issuer to unpause", nv.settlementPrice());
    }

    function _one(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }
}

interface IStock {
    function adminBurn(address from, uint256 amount) external;
    function pause() external;
}

interface IRegistry {
    function blockAccounts(address[] calldata accounts) external;
    function isBlocked(address account) external view returns (bool);
}
