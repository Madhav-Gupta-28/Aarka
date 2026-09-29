// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice AUDIT-24 — the parity arb goes quiet when the triggering swap's input has not settled.
///
/// @dev Found by running the parity demo on the live testnet with a deliberately oversized sell
///      (tx 0x205211aa…, block 122,649,574, 22 Sep 2026): 198,652 floor tokens into a pool holding
///      about $1.4m. The swap succeeded, the hook emitted nothing, and the flagship market was left
///      9,555 bps out of parity.
///
///      Why. v4 settles a swap's input currency only after `afterSwap` returns, so while the hook
///      runs, the tokens being sold are still an outstanding debt — the PoolManager does not hold
///      them yet. The arb's legs end in a real `take`, which moves real tokens out of the
///      PoolManager's real balance. Sized purely off the curve, that take asked for 16,475 floor
///      tokens from a PoolManager holding 7,014. The ERC20 reverted, the try/catch in `afterSwap`
///      swallowed it, and the trade went through with parity wide open.
///
///      The shape of the failure is backwards: a bigger swap opens a bigger gap, which draws a
///      bigger arb, which is likelier to outrun the balance. The hook falls silent as the reason to
///      act grows.
///
///      Severity is low, and stating why matters more than the finding. Nothing is lost — the hook
///      holds no inventory, the user's trade is untouched, and the vault's 1:1 identity is
///      unaffected, so the arb stays available to anyone. And the trigger needs a single trade that
///      moves a pool by orders of magnitude: at the depth these pools carry, an ordinary swap draws
///      an arb of tens of tokens against a balance of thousands.
///
///      What the fix does and does not do, measured below. Sizing the arb against the PoolManager's
///      real balance turns a silent no-op into a correction at whatever size is actually there —
///      9,555 bps becomes 9,095. It does not repair the pool, because repairing it means buying an
///      equal quantity of the *upside* half, and that pool is far too shallow to absorb it. That
///      residue is a liquidity-depth limit, not a hook defect: no arbitrageur, inside this
///      transaction or after it, could do better.
///
///      forge test --match-path test/hook/UnsettledInputFork.t.sol \
///        --fork-url $RPC_TESTNET --fork-block-number 122649573
contract UnsettledInputForkTest is Test {
    address constant ROUTER = 0xe7C93E5b953a98F1601D469bFb30eE6f687c678a;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant HOOK_LENS = 0x414326E556667b5AE9931F67cDb267D1BAF7D1D0;

    address constant HOOK = 0x553f8d548b85b078152A6901fA19bEa19D8a0040;
    address constant SERIES = 0x7D31f372d747EDB24dB9242d5e48Cf68aA8dBdcF;
    address constant FLOOR = 0xBadB39D05A2C4A6ED61195Afc11bdf1Ac025D9fc;
    address constant UPSIDE = 0x5B881dBF62Bb0540399A9A0cfc5A10247Cca1AAa;
    address constant USDG = 0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097;

    address constant HOOK_OWNER = 0x567c86000fFe158e750AA8bbEce64f1A1E2ed10f;
    address constant SELLER = 0x567c86000fFe158e750AA8bbEce64f1A1E2ed10f;

    /// @dev The amount actually sold in the reproduction.
    uint256 constant SALE = 198_652_584_270_624_415_420_074;

    /// @dev What the deployed hook left behind, as the explorer records it.
    uint256 constant GAP_AS_DEPLOYED = 9555;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    function setUp() public {
        vm.skip(block.chainid != 46630);
    }

    /// @notice The bug as it happened, pinned to the block that produced it.
    /// @dev The code at this block is the deployed hook, so this stays a record of the old
    ///      behaviour no matter what is deployed later.
    function test_AUDIT24_theDeployedHookWentQuiet() public {
        uint256 held = IERC20(FLOOR).balanceOf(POOL_MANAGER);
        console.log("floor held by the PoolManager:", held / 1e18);
        console.log("floor about to be sold:       ", SALE / 1e18);
        assertLt(held, SALE, "the reproduction needs a sale larger than the standing reserve");

        assertLt(_gapBps(), 100, "the market starts at parity");
        _sell();

        // The arb never got far enough to acquire anything, so the hook is empty either way.
        assertEq(IERC20(FLOOR).balanceOf(HOOK), 0, "hook kept floor tokens");
        assertEq(IERC20(UPSIDE).balanceOf(HOOK), 0, "hook kept upside tokens");

        assertEq(_gapBps(), GAP_AS_DEPLOYED, "the deployed hook did nothing at all");
    }

    /// @notice The fix, against the same block and the same trade: size the arb off the
    ///         PoolManager's real balance, not the curve alone, and the hook acts.
    /// @dev The hook is put back at its mined address with the fixed code. Storage survives the
    ///      etch, so the pools stay wired and the params stay as they are on chain — only the
    ///      sizing changes.
    ///
    ///      The current constructor asserts the address carries all of `PERMISSIONS` (AUDIT-27), and
    ///      the deployed hook was mined for AFTER_SWAP_FLAG alone, so the code is built at a scratch
    ///      address with the right bits and its runtime copied over. Nothing in the constructor
    ///      reads its own address into an immutable, so the copy is exact, and the added
    ///      `liquidityAddedAt` mapping sits after every existing slot. v4 still sees only the old
    ///      address's bits, so the liquidity hold stays dormant here; sizing is all that changes.
    ///
    ///      The build runs on a second fork at the latest block: the public RPC keeps no history
    ///      for accounts it has not already served at this block, and a scratch address is one of
    ///      those. The constructor only reads the series and its tokens, which have not changed.
    function test_AUDIT24_sizingAgainstTheRealBalanceFixesIt() public {
        uint256 pinned = vm.activeFork();
        vm.createSelectFork(vm.rpcUrl("robinhood_testnet"));
        address scratch = address(uint160(uint256(keccak256("aarka.scratch.hook"))) & ~uint160(0x3FFF) | 0x640);
        deployCodeTo(
            "AarkaParityHook.sol:AarkaParityHook",
            abi.encode(POOL_MANAGER, SERIES, USDG, HOOK_OWNER),
            scratch
        );
        bytes memory fixedCode = scratch.code;
        vm.selectFork(pinned);
        vm.etch(HOOK, fixedCode);

        _sell();

        uint256 gap = _gapBps();
        console.log("gap left by the deployed hook (bps):", GAP_AS_DEPLOYED);
        console.log("gap left by the fixed hook    (bps):", gap);

        assertEq(IERC20(FLOOR).balanceOf(HOOK), 0, "hook kept floor tokens");
        assertEq(IERC20(UPSIDE).balanceOf(HOOK), 0, "hook kept upside tokens");
        assertLt(gap, GAP_AS_DEPLOYED, "the fixed hook must act where the deployed one went quiet");
    }

    function _sell() private {
        vm.startPrank(SELLER);
        IERC20(FLOOR).approve(ROUTER, type(uint256).max);
        (bool ok,) = ROUTER.call(
            abi.encodeWithSignature(
                "swapExactIn((address,address,uint24,int24,address),bool,uint256,uint256,address)",
                PoolKey(FLOOR, USDG, 3000, 60, HOOK),
                true,
                SALE,
                uint256(0),
                SELLER
            )
        );
        vm.stopPrank();
        assertTrue(ok, "the user's swap itself must still succeed");
    }

    function _gapBps() private view returns (uint256) {
        (bool ok, bytes memory out) = HOOK_LENS.staticcall(abi.encodeWithSignature("parity(address)", HOOK));
        require(ok, "lens");
        // gapBps is the eighth field of the returned struct.
        uint256 gap;
        assembly {
            gap := mload(add(out, add(32, mul(32, 7))))
        }
        return gap;
    }
}
