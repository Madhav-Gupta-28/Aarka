// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice A Chainlink aggregator with a writable round history, including the ability to make a
///         round id revert so the phase-boundary path in AarkaSeries can be exercised.
contract MockAggregator {
    struct Round {
        int256 answer;
        uint256 updatedAt;
        bool exists;
        bool reverts;
    }

    uint8 public decimals = 8;
    string public description = "MOCK / USD";

    mapping(uint80 => Round) public rounds;
    uint80 public latestRound;

    function setDecimals(uint8 d) external {
        decimals = d;
    }

    function pushRound(uint80 id, int256 answer, uint256 updatedAt) external {
        rounds[id] = Round(answer, updatedAt, true, false);
        if (id > latestRound) latestRound = id;
    }

    /// @notice Make this round id revert, as a Chainlink proxy does past a phase boundary.
    function setReverting(uint80 id) external {
        rounds[id].reverts = true;
    }

    function getRoundData(uint80 id)
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        Round memory r = rounds[id];
        require(!r.reverts, "No data present");
        if (!r.exists) return (id, 0, 0, 0, id);
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[latestRound];
        return (latestRound, r.answer, r.updatedAt, r.updatedAt, latestRound);
    }
}

/// @notice Chainlink L2 sequencer uptime feed. answer 0 = up, 1 = down.
contract MockSequencerFeed {
    int256 public answer;
    uint256 public startedAt;

    constructor() {
        startedAt = 1;
    }

    function set(int256 a, uint256 s) external {
        answer = a;
        startedAt = s;
    }

    function decimals() external pure returns (uint8) {
        return 0;
    }

    function description() external pure returns (string memory) {
        return "SEQ";
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, startedAt, 1);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, startedAt, 1);
    }
}
