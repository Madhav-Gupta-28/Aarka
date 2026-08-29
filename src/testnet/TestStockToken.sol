// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestStockToken
/// @notice TESTNET ONLY. Stands in for a Robinhood stock token on chain 46630.
///
/// @dev Robinhood Chain testnet has no stock tokens — the mainnet NVDA address returns zero
///      bytecode there (ARCHITECTURE.md appendix B.2). This reproduces the parts of the real
///      contract that Aarka actually depends on, and nothing else.
///
///      Faithful to mainnet in the three ways that matter:
///        - 18 decimals, plain ERC-20, no transfer hooks
///        - ERC-8056: uiMultiplier(), newUIMultiplier(), effectiveAt()
///        - the Robinhood addition oraclePaused()
///
///      `effectiveAt` deliberately is NOT cleared when an action is applied, because the real
///      contract does not clear it either — AAPL carries a stale one on mainnet. That behaviour
///      is the bug the fork tests caught, so the mock has to reproduce it or the testnet
///      deployment would be easier to pass than reality.
contract TestStockToken is ERC20, Ownable {
    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier;
    uint256 public effectiveAt;
    bool public oraclePaused;

    /// @notice Free tokens, so a judge can use the app without asking anyone for anything.
    uint256 public constant FAUCET_AMOUNT = 100e18;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    mapping(address => uint256) public lastClaimed;

    event CorporateActionScheduled(uint256 newMultiplier, uint256 effectiveAt);
    event CorporateActionApplied(uint256 oldMultiplier, uint256 newMultiplier);
    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);

    error FaucetCooldown(uint256 availableAt);

    constructor(string memory name_, string memory symbol_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {}

    /// @notice Anyone can claim once an hour.
    function claim() external {
        uint256 next = lastClaimed[msg.sender] + FAUCET_COOLDOWN;
        if (lastClaimed[msg.sender] != 0 && block.timestamp < next) revert FaucetCooldown(next);
        lastClaimed[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // ---------------------------------------------------------------- corporate actions

    /// @notice Announce an action ahead of time, the way ERC-8056's pending extension does.
    function scheduleCorporateAction(uint256 multiplier, uint256 at) external onlyOwner {
        newUIMultiplier = multiplier;
        effectiveAt = at;
        emit CorporateActionScheduled(multiplier, at);
    }

    /// @notice Apply a scheduled action. Note `effectiveAt` is left set, matching mainnet.
    function applyCorporateAction() external onlyOwner {
        uint256 old = uiMultiplier;
        uiMultiplier = newUIMultiplier;
        newUIMultiplier = 0;
        emit CorporateActionApplied(old, uiMultiplier);
        emit UIMultiplierUpdated(old, uiMultiplier, effectiveAt);
    }

    function setOraclePaused(bool paused) external onlyOwner {
        oraclePaused = paused;
    }
}
