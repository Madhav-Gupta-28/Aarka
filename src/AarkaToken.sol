// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title AarkaToken
/// @notice One half of a split stock token. Two of these are deployed per series.
/// @dev Deliberately minimal. No owner, no pause, no blocklist, no upgrade path. The only
///      privileged caller is the series that deployed it, and that address is immutable.
///
///      `burn` takes tokens from an arbitrary holder without an allowance. That is safe only
///      because `series` is fixed at construction and the series code burns solely from the
///      account that called it. There is no path by which any other contract can reach it.
contract AarkaToken is ERC20 {
    /// @notice The series that deployed this token and is its only minter and burner.
    address public immutable series;

    error NotSeries();

    modifier onlySeries() {
        if (msg.sender != series) revert NotSeries();
        _;
    }

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        series = msg.sender;
    }

    function mint(address to, uint256 amount) external onlySeries {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlySeries {
        _burn(from, amount);
    }
}
