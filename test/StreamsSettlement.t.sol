// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {StreamsAggregator, IVerifierProxy} from "../src/adapters/StreamsAggregator.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";
import {MockVerifierProxy} from "./StreamsAggregator.t.sol";

/// @notice A series priced by Chainlink Data Streams, settled end to end.
///
/// @dev X Layer has no push feed for equities, which is what Aarka was built against. It has Data
///      Streams, which OKX brought there in June 2026. This is the whole point of the adapter: the
///      vault, the settlement rules and the payout arithmetic are the audited ones, unchanged. Only
///      where the price comes from is different.
contract StreamsSettlementTest is Test {
    bytes32 constant NVDA_REGULAR = bytes32(uint256(0x0b01));
    bytes32 constant NVDA_OVERNIGHT = bytes32(uint256(0x0b03));

    uint64 constant EXPIRY = 1_790_366_400; // Fri 25 Sep 2026, 16:00 ET
    uint256 constant STRIKE = 210e8;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    MockVerifierProxy verifier;
    StreamsAggregator feed;
    MockStockToken nvdax;
    AarkaSeries series;

    function setUp() public {
        vm.warp(EXPIRY - 30 days);
        verifier = new MockVerifierProxy();

        bytes32[] memory feeds = new bytes32[](2);
        feeds[0] = NVDA_REGULAR;
        feeds[1] = NVDA_OVERNIGHT;
        feed = new StreamsAggregator(IVerifierProxy(address(verifier)), feeds, "NVDA / USD");

        nvdax = new MockStockToken("NVIDIA xStock", "NVDAx");
        series = new AarkaSeries(
            IERC20(address(nvdax)), AggregatorV3Interface(address(feed)),
            AggregatorV3Interface(address(0)), STRIKE, EXPIRY
        );

        nvdax.mint(alice, 100e18);
        vm.prank(alice);
        nvdax.approve(address(series), type(uint256).max);
    }

    function _submit(bytes32 feedId, int192 mid18, uint32 observedAt, uint32 status) internal {
        feed.submit(
            abi.encode(
                StreamsAggregator.ReportV11({
                    feedId: feedId, validFromTimestamp: observedAt, observationsTimestamp: observedAt,
                    nativeFee: 0, linkFee: 0, expiresAt: observedAt + 1 days, mid: mid18,
                    lastSeenTimestampNs: uint64(observedAt) * 1e9, bid: mid18, bidVolume: 1e18,
                    ask: mid18, askVolume: 1e18, lastTradedPrice: mid18, marketStatus: status
                })
            )
        );
    }

    /// @notice Split real tokenized NVIDIA, sell one half, settle on the Data Streams close, claim.
    function test_theWholeLifecycleOnDataStreams() public {
        vm.prank(alice);
        series.mint(100e18, alice);
        assertEq(series.floorToken().symbol(), "fNVDAx-210-25SEP26");

        // alice sells the upside to bob and holds the floor alone. This is the position that used
        // to be strandable, and the one settlement has to resolve.
        address upside = address(series.upsideToken());
        vm.prank(alice);
        IERC20(upside).transfer(bob, 100e18);

        _submit(NVDA_OVERNIGHT, 228e18, uint32(EXPIRY - 20 hours), 4);
        _submit(NVDA_REGULAR, 240e18, uint32(EXPIRY - 25 minutes), 2); // the close
        _submit(NVDA_OVERNIGHT, 244e18, uint32(EXPIRY + 2 hours), 4); // after expiry, must be ignored

        vm.warp(EXPIRY + 1);
        series.settle(2);

        assertEq(series.settlementPrice(), 240e8, "the last price printed before the close");
        assertFalse(series.settledLate());
        assertEq(series.floorPayoutPerUnit() + series.upsidePayoutPerUnit(), 1e18);

        vm.warp(block.timestamp + series.CHALLENGE_PERIOD());
        vm.prank(alice);
        uint256 toFloor = series.claimFloor(100e18, alice);
        vm.prank(bob);
        uint256 toUpside = series.claimUpside(100e18, bob);

        // min(S,K)/S is 210/240, which divides exactly, so 100 tokens in and 100 back out.
        assertEq(toFloor, 87.5e18);
        assertEq(toUpside, 12.5e18);
        assertEq(toFloor + toUpside, 100e18);
        assertEq(nvdax.balanceOf(address(series)), 0, "nothing left behind");
    }

    /// @notice A report from after expiry cannot be used to settle, however tempting the price.
    function test_aReportAfterExpiryIsRefused() public {
        _submit(NVDA_REGULAR, 240e18, uint32(EXPIRY - 25 minutes), 2);
        _submit(NVDA_OVERNIGHT, 300e18, uint32(EXPIRY + 1 hours), 4);
        vm.warp(EXPIRY + 2 hours);

        vm.expectRevert(AarkaSeries.RoundAfterExpiry.selector);
        series.settle(2);
        series.settle(1);
        assertEq(series.settlementPrice(), 240e8);
    }

    /// @notice A weekend expiry is impossible by construction, but a quiet close is not. The
    ///         26-hour rule from AUDIT-16 carries over unchanged.
    function test_aQuietCloseStillSettles() public {
        _submit(NVDA_OVERNIGHT, 236e18, uint32(EXPIRY - 22 hours), 4);
        vm.warp(EXPIRY + 1);
        series.settle(1);
        assertEq(series.settlementPrice(), 236e8);
        assertFalse(series.settledLate(), "22 hours is inside the window, not the late path");
    }
}
