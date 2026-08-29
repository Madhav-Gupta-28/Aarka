// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSDG
/// @notice TESTNET ONLY. Stands in for USDG, the quote asset on Robinhood Chain.
/// @dev Six decimals, matching mainnet USDG at 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168.
///      Getting this wrong is the easiest way to break the hook, which prices three pools against
///      a single quote and relies on the decimal scaling being identical across all three.
contract TestUSDG is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    mapping(address => uint256) public lastClaimed;

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Global Dollar - Aarka Testnet", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function claim() external {
        uint256 next = lastClaimed[msg.sender] + FAUCET_COOLDOWN;
        if (lastClaimed[msg.sender] != 0 && block.timestamp < next) revert FaucetCooldown(next);
        lastClaimed[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @dev Open mint. This is a testnet quote asset with no value; gating it would only make the
    ///      demo harder to run.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
