// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StreamsAggregator, IVerifierProxy} from "../src/adapters/StreamsAggregator.sol";

/// @notice Stands in for Chainlink's verifier proxy. The real one checks DON signatures and returns
///         the report; a forged payload never gets this far. Here the payload is the report, which
///         lets the tests drive every field.
contract MockVerifierProxy is IVerifierProxy {
    bool public shouldReject;

    function setRejecting(bool v) external {
        shouldReject = v;
    }

    function verify(bytes calldata payload, bytes calldata parameterPayload)
        external
        payable
        returns (bytes memory)
    {
        require(!shouldReject, "bad signature");
        require(parameterPayload.length == 0, "fee metadata should be empty under subscription billing");
        return payload;
    }
}

contract StreamsAggregatorTest is Test {
    // NVDA publishes one stream per trading phase; all three describe the same security.
    bytes32 constant NVDA_REGULAR = bytes32(uint256(0x0b01));
    bytes32 constant NVDA_EXTENDED = bytes32(uint256(0x0b02));
    bytes32 constant NVDA_OVERNIGHT = bytes32(uint256(0x0b03));
    bytes32 constant TSLA_REGULAR = bytes32(uint256(0x0b09));

    uint32 constant T0 = 1_790_000_000;

    MockVerifierProxy verifier;
    StreamsAggregator agg;

    function setUp() public {
        verifier = new MockVerifierProxy();
        bytes32[] memory feeds = new bytes32[](3);
        feeds[0] = NVDA_REGULAR;
        feeds[1] = NVDA_EXTENDED;
        feeds[2] = NVDA_OVERNIGHT;
        agg = new StreamsAggregator(IVerifierProxy(address(verifier)), feeds, "NVDA / USD - Data Streams");
    }

    /// @dev A report as the API returns it. Prices arrive with 18 decimals.
    function _report(bytes32 feedId, int192 mid18, uint32 observedAt, uint32 marketStatus)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(
            StreamsAggregator.ReportV11({
                feedId: feedId,
                validFromTimestamp: observedAt,
                observationsTimestamp: observedAt,
                nativeFee: 0,
                linkFee: 0,
                expiresAt: observedAt + 1 days,
                mid: mid18,
                lastSeenTimestampNs: uint64(observedAt) * 1e9,
                bid: mid18 - 1e16,
                bidVolume: 100e18,
                ask: mid18 + 1e16,
                askVolume: 100e18,
                lastTradedPrice: mid18,
                marketStatus: marketStatus
            })
        );
    }

    function test_recordsAVerifiedReportAsARound() public {
        agg.submit(_report(NVDA_REGULAR, 211.93e18, T0, 2));

        (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredIn) = agg.latestRoundData();
        assertEq(id, 1);
        assertEq(answer, 211_93000000, "18 decimals in, 8 decimals out");
        assertEq(updatedAt, T0, "time comes from the report, not the block");
        assertEq(startedAt, T0);
        assertEq(answeredIn, 1);
        assertEq(agg.decimals(), 8, "AarkaSeries asserts 8 and would refuse anything else");
    }

    function test_allThreeTradingPhasesFeedOneHistory() public {
        agg.submit(_report(NVDA_OVERNIGHT, 210e18, T0, 4));
        agg.submit(_report(NVDA_EXTENDED, 211e18, T0 + 3600, 1));
        agg.submit(_report(NVDA_REGULAR, 212e18, T0 + 7200, 2));

        assertEq(agg.latestRound(), 3);
        assertEq(agg.marketStatusOf(1), 4);
        assertEq(agg.marketStatusOf(3), 2);
        (, int256 first,,,) = agg.getRoundData(1);
        assertEq(first, 210_00000000);
    }

    function test_refusesAStreamThatIsNotThisInstrument() public {
        vm.expectRevert(abi.encodeWithSelector(StreamsAggregator.UnknownStream.selector, TSLA_REGULAR));
        agg.submit(_report(TSLA_REGULAR, 358e18, T0, 2));
    }

    /// @dev The point of using v11: a closed market says so, instead of being inferred from silence.
    function test_refusesAClosedOrUnknownMarket() public {
        vm.expectRevert(abi.encodeWithSelector(StreamsAggregator.MarketClosed.selector, uint32(5)));
        agg.submit(_report(NVDA_REGULAR, 211e18, T0, 5));

        vm.expectRevert(abi.encodeWithSelector(StreamsAggregator.MarketClosed.selector, uint32(0)));
        agg.submit(_report(NVDA_REGULAR, 211e18, T0, 0));

        assertEq(agg.latestRound(), 0, "nothing recorded");
    }

    /// @dev Two phases publish concurrently, so arrival order is not observation order.
    function test_refusesAReportOlderThanTheLatest() public {
        agg.submit(_report(NVDA_REGULAR, 212e18, T0 + 7200, 2));
        vm.expectRevert(
            abi.encodeWithSelector(StreamsAggregator.NotNewer.selector, uint32(T0), uint32(T0 + 7200))
        );
        agg.submit(_report(NVDA_EXTENDED, 211e18, T0, 1));
    }

    function test_refusesAnUnverifiableReport() public {
        verifier.setRejecting(true);
        vm.expectRevert(bytes("bad signature"));
        agg.submit(_report(NVDA_REGULAR, 211e18, T0, 2));
    }

    function test_refusesANonPositivePrice() public {
        vm.expectRevert(abi.encodeWithSelector(StreamsAggregator.InvalidPrice.selector, int192(0)));
        agg.submit(_report(NVDA_REGULAR, 0, T0, 2));

        // Below a hundredth of a cent, the 8-decimal answer would round to zero.
        vm.expectRevert(abi.encodeWithSelector(StreamsAggregator.InvalidPrice.selector, int192(1e9)));
        agg.submit(_report(NVDA_REGULAR, 1e9, T0, 2));
    }

    /// @dev AarkaSeries walks to `roundId + 1` to prove it pinned the last round before expiry, and
    ///      relies on a missing round reverting rather than returning zeros.
    function test_anUnknownRoundReverts() public {
        agg.submit(_report(NVDA_REGULAR, 211e18, T0, 2));
        vm.expectRevert(StreamsAggregator.NoDataPresent.selector);
        agg.getRoundData(2);
    }

    function test_refusesDeploymentWithNoStreams() public {
        vm.expectRevert(StreamsAggregator.NoStreams.selector);
        new StreamsAggregator(IVerifierProxy(address(verifier)), new bytes32[](0), "empty");
    }
}
