// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestAggregator
/// @notice TESTNET ONLY. Stands in for a Chainlink Robinhood equity feed on chain 46630.
///
/// @dev Chainlink deploys these feeds on Robinhood Chain mainnet only. This reproduces the
///      behaviour Aarka's settlement logic is written against:
///
///        - 8 decimals, matching every one of the 35 real equity feeds
///        - composite round ids, `(phaseId << 64) | aggregatorRoundId`, so the phase-boundary
///          handling in AarkaSeries._requireNoLaterRound is exercised rather than bypassed
///        - a real round history, so settle() can pin a historical round the way it must on mainnet
///        - getRoundData reverts on an unknown id in the current phase, as a real proxy does
contract TestAggregator is Ownable {
    uint8 public constant decimals = 8;
    string public description;

    uint64 public phaseId = 1;
    uint64 public aggregatorRound;

    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    mapping(uint80 => Round) private _rounds;

    event RoundPushed(uint80 indexed roundId, int256 answer, uint256 updatedAt);
    event PhaseAdvanced(uint64 newPhaseId);

    error NoDataPresent();

    constructor(string memory description_, int256 initialAnswer, address owner_) Ownable(owner_) {
        description = description_;
        _push(initialAnswer, block.timestamp);
    }

    function _roundId(uint64 phase, uint64 round) internal pure returns (uint80) {
        return uint80((uint256(phase) << 64) | uint256(round));
    }

    function latestRound() external view returns (uint80) {
        return _roundId(phaseId, aggregatorRound);
    }

    function _push(int256 answer, uint256 at) internal {
        aggregatorRound += 1;
        uint80 id = _roundId(phaseId, aggregatorRound);
        _rounds[id] = Round(answer, at);
        emit RoundPushed(id, answer, at);
    }

    /// @notice Publish a new price at the current block time.
    function pushRound(int256 answer) external onlyOwner {
        _push(answer, block.timestamp);
    }

    /// @notice Publish a price backdated to `at`, so a settleable history can be built in one go.
    function pushRoundAt(int256 answer, uint256 at) external onlyOwner {
        _push(answer, at);
    }

    /// @notice Simulate a Chainlink aggregator migration, which is what makes roundId + 1 a
    ///         well-formed id that does not exist.
    function advancePhase() external onlyOwner {
        phaseId += 1;
        aggregatorRound = 0;
        emit PhaseAdvanced(phaseId);
    }

    function getRoundData(uint80 id)
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        Round memory r = _rounds[id];
        if (r.updatedAt == 0) revert NoDataPresent();
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint80 id = _roundId(phaseId, aggregatorRound);
        Round memory r = _rounds[id];
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }
}
