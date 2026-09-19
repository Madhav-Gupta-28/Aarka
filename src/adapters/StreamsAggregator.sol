// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AggregatorV3Interface} from "../interfaces/IExternal.sol";

/// @notice Chainlink Data Streams verifier proxy. Verification is billed by subscription, so the
///         fee metadata is empty and the call carries no value.
interface IVerifierProxy {
    function verify(bytes calldata payload, bytes calldata parameterPayload)
        external
        payable
        returns (bytes memory verifierResponse);
}

/// @title StreamsAggregator
/// @notice Turns Chainlink Data Streams reports into the round history Aarka settles against.
///
/// @dev Aarka reads a price the way Chainlink's push feeds present one: a history of rounds, each
///      with a price and the time it was observed, which `settle()` pins one of. X Layer has no
///      push feed for equities. What it has, since OKX brought it there in June 2026, is Data
///      Streams: signed reports fetched off-chain and verified on-chain, on demand.
///
///      This is the adapter between the two. Anyone submits a signed report; this contract has it
///      verified by Chainlink's proxy, checks it belongs to this instrument, and appends it as a
///      round. Nothing in the protocol changes — the factory, the vault, the settlement rules, the
///      hook and the router all read this exactly as they read a Chainlink aggregator.
///
///      Three properties are worth stating, because they are why this is safe to settle against:
///
///      **The submitter cannot choose the price.** They choose when to submit. The report is signed
///      by the Data Streams DON and verified on chain; a forged or altered one does not verify.
///
///      **Time comes from the report, not the block.** A round's `updatedAt` is the report's
///      `observationsTimestamp`, so `settle()` pins the price by when the market printed it rather
///      than when someone got around to sending a transaction.
///
///      **A closed market is rejected outright.** The v11 schema carries `marketStatus`, so this
///      refuses reports from a closed or unknown session rather than inferring the session from
///      silence. On Robinhood Chain that inference is exactly what stranded holders (AUDIT-16).
///
///      One instance holds the streams of one instrument. A 24/5 US equity publishes a separate
///      stream per trading phase — regular, extended, overnight — and all three describe the same
///      security, so all three are accepted here and ordered into a single history by observation
///      time.
contract StreamsAggregator is AggregatorV3Interface {
    /// @notice Chainlink prices arrive with 18 decimals; equity feeds are quoted with 8, and Aarka
    ///         asserts 8 rather than assuming it.
    uint8 public constant override decimals = 8;
    int192 private constant SCALE_DOWN = 1e10;

    /// @notice v11, RWA Advanced: the schema the 24/5 US equity streams publish.
    struct ReportV11 {
        bytes32 feedId;
        uint32 validFromTimestamp;
        uint32 observationsTimestamp;
        uint192 nativeFee;
        uint192 linkFee;
        uint32 expiresAt;
        int192 mid;
        uint64 lastSeenTimestampNs;
        int192 bid;
        int192 bidVolume;
        int192 ask;
        int192 askVolume;
        int192 lastTradedPrice;
        uint32 marketStatus;
    }

    /// @dev Market status values for a 24/5 US equity stream. 0 is unknown and 5 is closed; both
    ///      mean there is no live market behind the number, and neither is recorded.
    uint32 private constant STATUS_UNKNOWN = 0;
    uint32 private constant STATUS_CLOSED = 5;

    struct Round {
        int192 answer; // 8 decimals
        uint32 observedAt;
        uint32 marketStatus;
    }

    IVerifierProxy public immutable verifierProxy;
    string public override description;

    /// @notice The streams this instrument publishes, one per trading phase.
    mapping(bytes32 feedId => bool) public isInstrumentStream;

    mapping(uint80 roundId => Round) private _rounds;
    uint80 public latestRound;

    event RoundRecorded(
        uint80 indexed roundId, bytes32 indexed feedId, int192 answer, uint32 observedAt, uint32 marketStatus
    );

    error NoStreams();
    error UnknownStream(bytes32 feedId);
    error MarketClosed(uint32 marketStatus);
    error NotNewer(uint32 observedAt, uint32 latestObservedAt);
    error InvalidPrice(int192 mid);
    error NoDataPresent();

    /// @param feedIds every stream of one instrument: regular, extended and overnight hours.
    constructor(IVerifierProxy verifierProxy_, bytes32[] memory feedIds, string memory description_) {
        if (feedIds.length == 0) revert NoStreams();
        verifierProxy = verifierProxy_;
        description = description_;
        for (uint256 i; i < feedIds.length; ++i) {
            isInstrumentStream[feedIds[i]] = true;
        }
    }

    // --------------------------------------------------------------------
    // Recording
    // --------------------------------------------------------------------

    /// @notice Verify a Data Streams report and append it as a round.
    /// @dev Permissionless, like `settle()` itself. The submitter pays the gas and gets nothing for
    ///      it, and cannot influence the result: the report is signed, and everything recorded is
    ///      read out of it.
    /// @param payload the raw payload from the Data Streams API, passed through untouched.
    function submit(bytes calldata payload) external payable returns (uint80 roundId) {
        bytes memory verified = verifierProxy.verify{value: msg.value}(payload, "");
        ReportV11 memory report = abi.decode(verified, (ReportV11));

        if (!isInstrumentStream[report.feedId]) revert UnknownStream(report.feedId);
        if (report.marketStatus == STATUS_UNKNOWN || report.marketStatus == STATUS_CLOSED) {
            revert MarketClosed(report.marketStatus);
        }
        if (report.mid <= 0) revert InvalidPrice(report.mid);

        // Reports are ordered by when the market printed them, not by arrival. Two phases of the
        // same instrument publish concurrently, so a late report of an earlier observation must not
        // become the newest round and displace a fresher price.
        uint32 latestObservedAt = _rounds[latestRound].observedAt;
        if (report.observationsTimestamp <= latestObservedAt) {
            revert NotNewer(report.observationsTimestamp, latestObservedAt);
        }

        roundId = latestRound + 1;
        int192 answer = report.mid / SCALE_DOWN;
        if (answer <= 0) revert InvalidPrice(report.mid);

        _rounds[roundId] = Round(answer, report.observationsTimestamp, report.marketStatus);
        latestRound = roundId;

        emit RoundRecorded(roundId, report.feedId, answer, report.observationsTimestamp, report.marketStatus);
    }

    // --------------------------------------------------------------------
    // Reads
    // --------------------------------------------------------------------

    /// @dev Reverts on a round that does not exist, which is what a Chainlink proxy does and what
    ///      the successor check in AarkaSeries is written against.
    function getRoundData(uint80 roundId)
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        Round memory r = _rounds[roundId];
        if (r.observedAt == 0) revert NoDataPresent();
        return (roundId, int256(r.answer), r.observedAt, r.observedAt, roundId);
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[latestRound];
        return (latestRound, int256(r.answer), r.observedAt, r.observedAt, latestRound);
    }

    /// @notice The trading phase the price in `roundId` was observed in.
    function marketStatusOf(uint80 roundId) external view returns (uint32) {
        return _rounds[roundId].marketStatus;
    }
}
