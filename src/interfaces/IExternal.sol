// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Chainlink aggregator, the subset Aarka uses.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function latestRoundData()
        external
        view
        returns (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice ERC-8056 Scaled UI Amount Extension, implemented by Robinhood stock tokens.
/// @dev Aarka reads these as safety signals only. The Chainlink price already includes the
///      multiplier, so applying it here would double-count it. See ARCHITECTURE.md section 4.
interface IScaledUIAmount {
    function uiMultiplier() external view returns (uint256);
}

/// @notice ERC-8056 pending-multiplier extension. A corporate action is announced before it lands,
///         which is what lets a series refuse to be written across one.
interface IScaledUIAmountNewUIMultiplier {
    function newUIMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
}

/// @notice Robinhood addition, not part of ERC-8056. Probed with staticcall, never assumed.
interface IOraclePausable {
    function oraclePaused() external view returns (bool);
}
