// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ExpiryCalendar
/// @notice A published list of valid expiry timestamps.
/// @dev A valid expiry must avoid weekends and market holidays, when the Chainlink equity feeds
///      stop publishing entirely, and by convention lands on the 16:00 ET close. None of that is
///      computable on-chain: it depends on the NYSE holiday calendar, on early-close days, and on
///      US daylight saving, which moves 16:00 ET between 20:00 and 21:00 UTC.
///
///      Publishing the calendar is the honest solution, and it is what exchanges do.
///
///      Timestamps can only be added, never removed. A series that already exists can therefore
///      never have its expiry invalidated. The worst a hostile operator can do is refuse to add
///      future dates, which blocks new series and does nothing at all to existing ones.
contract ExpiryCalendar is Ownable {
    mapping(uint64 => bool) public isValidExpiry;

    event ExpiryAdded(uint64 indexed timestamp);

    error AlreadyAdded(uint64 timestamp);
    error NotInFuture(uint64 timestamp);

    constructor(address owner_) Ownable(owner_) {}

    function addExpiries(uint64[] calldata timestamps) external onlyOwner {
        for (uint256 i; i < timestamps.length; ++i) {
            uint64 t = timestamps[i];
            if (t <= block.timestamp) revert NotInFuture(t);
            if (isValidExpiry[t]) revert AlreadyAdded(t);
            isValidExpiry[t] = true;
            emit ExpiryAdded(t);
        }
    }
}
