// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stands in for a Robinhood stock token: standard ERC-20, 18 decimals, ERC-8056
///         multiplier, and the Robinhood `oraclePaused()` addition.
contract MockStockToken is ERC20 {
    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier;
    uint256 public effectiveAt;
    bool public oraclePaused;

    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setOraclePaused(bool p) external {
        oraclePaused = p;
    }

    function scheduleCorporateAction(uint256 multiplier, uint256 at) external {
        newUIMultiplier = multiplier;
        effectiveAt = at;
    }

    function applyCorporateAction() external {
        uiMultiplier = newUIMultiplier;
        newUIMultiplier = 0;
        effectiveAt = 0;
    }
}

/// @notice A token with none of the optional interfaces, to prove the probes degrade gracefully.
contract PlainToken is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Takes a 1% fee on transfer, to prove the balance-delta accounting in mint holds.
contract FeeOnTransferToken is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/// @notice Consumes the entire transfer, so `received` is zero. Proves mint refuses a deposit
///         that did not actually arrive rather than minting halves against nothing.
contract BlackHoleToken is ERC20 {
    constructor(string memory n, string memory s_) ERC20(n, s_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            super._update(from, address(0xdead), value);
            return;
        }
        super._update(from, to, value);
    }
}
