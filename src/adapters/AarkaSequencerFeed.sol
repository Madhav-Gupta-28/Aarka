// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface} from "../interfaces/IExternal.sol";

/// @title AarkaSequencerFeed
/// @notice A stopgap L2 sequencer uptime feed for Robinhood Chain, in Chainlink's exact shape.
///
/// @dev Robinhood Chain is an Arbitrum Orbit L2, and its own documentation tells integrators to
///      check a Chainlink sequencer uptime feed before trusting a price. Chainlink publishes no
///      such feed for this chain: 57 feeds, 33 of them equities, no uptime feed (checked again on
///      22 Sep 2026). X Layer has one. Robinhood Chain does not.
///
///      So Aarka's sequencer guard has shipped disabled, with every series emitting
///      `SequencerCheckDisabled` to say so on chain. This fills the gap until Chainlink publishes
///      a real one, at which point `AarkaFactory.setSequencerFeed` points at theirs and this is
///      retired. It is not a decentralised oracle and does not pretend to be.
///
///      **Why trusting this reporter is bounded, and why it is strictly better than nothing.**
///      A hostile or broken reporter has exactly two moves:
///
///        says "down" when the chain is up   settlement reverts — but `AarkaSeries` ignores the
///                                           sequencer entirely once a series is
///                                           `LATE_SETTLEMENT_DELAY` past expiry, so the worst case
///                                           is a one-week delay, never stranded funds
///        says "up" when the chain is down   exactly the status quo, where no feed is wired at all
///
///      It can therefore make settlement stricter or leave it unchanged. It cannot make it looser
///      than today, and it cannot hold anyone's tokens hostage.
///
///      **It fails closed.** The reporter posts every time the keeper runs. If those reports stop
///      — the keeper dies, loses its key, or cannot reach the chain — this reports the sequencer as
///      down rather than continuing to vouch for a chain nobody is watching. Silence is not an
///      endorsement.
///
///      Semantics are Chainlink's, so a consumer written against theirs needs no changes:
///      `answer` is 0 for up and 1 for down, `startedAt` is when the current status began, and
///      `updatedAt` is when it was last confirmed. A consumer waiting out a grace period after a
///      restart reads `startedAt` and gets what it expects.
contract AarkaSequencerFeed is AggregatorV3Interface, Ownable {
    /// @notice Chainlink's uptime feeds carry a status, not a price.
    uint8 public constant override decimals = 0;
    string public constant override description = "L2 Sequencer Uptime Status Feed (Aarka stopgap)";

    int256 private constant UP = 0;
    int256 private constant DOWN = 1;

    /// @notice How long a report stays good for.
    /// @dev The keeper reports every 30 minutes. Three missed runs is not a blip, it is an
    ///      unwatched chain, and this then reports down.
    uint256 public constant MAX_REPORT_AGE = 100 minutes;

    struct Round {
        int256 answer;
        uint64 startedAt;
        uint64 updatedAt;
    }

    /// @notice The only account that may report. Rotatable, because keys get rotated.
    address public reporter;

    mapping(uint80 => Round) private _rounds;
    uint80 public latestRound;

    event Reported(uint80 indexed roundId, int256 answer, uint64 startedAt, uint64 updatedAt);
    event ReporterSet(address indexed reporter);

    error NotReporter();
    error NoDataPresent();

    constructor(address owner_, address reporter_) Ownable(owner_) {
        reporter = reporter_;
        emit ReporterSet(reporter_);
    }

    function setReporter(address reporter_) external onlyOwner {
        reporter = reporter_;
        emit ReporterSet(reporter_);
    }

    // --------------------------------------------------------------------
    // Reporting
    // --------------------------------------------------------------------

    /// @notice Record what the keeper sees.
    /// @dev A status change opens a new round, so `startedAt` marks the moment the chain came back
    ///      and a consumer's grace period runs from there. An unchanged status refreshes the
    ///      current round, which is what keeps it from going stale.
    function report(bool up) external returns (uint80 roundId) {
        if (msg.sender != reporter) revert NotReporter();
        int256 answer = up ? UP : DOWN;

        Round memory current = _rounds[latestRound];
        if (latestRound != 0 && current.answer == answer) {
            _rounds[latestRound].updatedAt = uint64(block.timestamp);
            emit Reported(latestRound, answer, current.startedAt, uint64(block.timestamp));
            return latestRound;
        }

        roundId = latestRound + 1;
        _rounds[roundId] = Round(answer, uint64(block.timestamp), uint64(block.timestamp));
        latestRound = roundId;
        emit Reported(roundId, answer, uint64(block.timestamp), uint64(block.timestamp));
    }

    // --------------------------------------------------------------------
    // Reads
    // --------------------------------------------------------------------

    /// @notice The current status, reported as down whenever the last report has gone stale.
    /// @dev The staleness rule lives here rather than in the consumer because Chainlink's own feeds
    ///      have no such problem: theirs are maintained by a DON, this one by a single keeper.
    ///      Putting it here means a consumer written against Chainlink is safe without knowing.
    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        Round memory r = _rounds[latestRound];
        if (latestRound == 0) return (0, DOWN, 0, 0, 0);

        if (block.timestamp - r.updatedAt > MAX_REPORT_AGE) {
            // Nobody has confirmed the chain lately. Report down, and date the status from the last
            // confirmed observation so a consumer's grace period starts when reporting resumes.
            return (latestRound, DOWN, r.updatedAt, r.updatedAt, latestRound);
        }
        return (latestRound, r.answer, r.startedAt, r.updatedAt, latestRound);
    }

    /// @notice A recorded round, exactly as it was written.
    /// @dev No staleness rule here: history is history. Only the latest reading is a claim about
    ///      the chain right now.
    function getRoundData(uint80 roundId)
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        Round memory r = _rounds[roundId];
        if (r.updatedAt == 0) revert NoDataPresent();
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    /// @notice Whether the last report is recent enough to mean anything.
    function isFresh() external view returns (bool) {
        Round memory r = _rounds[latestRound];
        return latestRound != 0 && block.timestamp - r.updatedAt <= MAX_REPORT_AGE;
    }
}
