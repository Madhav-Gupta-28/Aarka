// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice The only non-mainnet contracts the fork suite uses, each standing in for a failure the
///         live chain cannot be made to produce on demand. Every test that uses one says so.
///
///         Everything else in test/fork/mainnet runs against the real tokens, feeds and pools.

/// @notice A Chainlink aggregator that misbehaves in the ways a real one occasionally does: an
///         older aggregator that reverts on a missing round, a round with no timestamp, a feed
///         whose decimals change, a round id at the very top of the range.
/// @dev Also used as the phase-2 aggregator behind the REAL NVDA proxy, to replay a Chainlink
///      aggregator migration through Chainlink's own EACAggregatorProxy.
contract BrokenFeed {
    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        bool set;
    }

    uint8 public decimals = 8;
    string public description = "stand-in";
    uint256 public version = 4;
    bool public revertOnMissing = true;
    bool public revertLatest;
    uint80 public latestId;
    mapping(uint80 => Round) internal rounds;

    function setDecimals(uint8 d) external {
        decimals = d;
    }

    function setRevertOnMissing(bool r) external {
        revertOnMissing = r;
    }

    function setRevertLatest(bool r) external {
        revertLatest = r;
    }

    function push(uint80 id, int256 answer, uint256 updatedAt) external {
        rounds[id] = Round(answer, updatedAt, updatedAt, true);
        if (id > latestId) latestId = id;
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[id];
        if (!r.set && revertOnMissing) revert("No data present");
        return (id, r.answer, r.startedAt, r.updatedAt, id);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (revertLatest) revert("feed down");
        Round memory r = rounds[latestId];
        return (latestId, r.answer, r.startedAt, r.updatedAt, latestId);
    }

    // The proxy forwards these legacy reads too.
    function latestAnswer() external view returns (int256) {
        return rounds[latestId].answer;
    }

    function latestTimestamp() external view returns (uint256) {
        return rounds[latestId].updatedAt;
    }

    function latestRound() external view returns (uint256) {
        return latestId;
    }
}

/// @notice A sequencer feed that says "up" without ever having started: the uninitialised-feed
///         case AarkaSeries refuses (startedAt == 0). AarkaSequencerFeed itself never reports it.
contract UpButNeverStartedFeed {
    function decimals() external pure returns (uint8) {
        return 0;
    }

    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) {
        return (1, 0, 0, 0, 1);
    }
}

/// @notice A token whose transferFrom reports success and moves nothing, so a deposit arrives as
///         zero. Stands in for any fee-on-transfer token at a 100% fee.
contract HollowToken is ERC20 {
    constructor() ERC20("Hollow", "HOLLOW") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return true;
    }
}

/// @notice A token whose symbol() reverts, for AarkaLens' guarded symbol read.
contract NamelessToken {
    function symbol() external pure returns (string memory) {
        revert("no symbol");
    }
}
