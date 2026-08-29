// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title DateLib
/// @notice Formats a unix timestamp as DDMMMYY, e.g. 26SEP26.
/// @dev Used to derive token symbols on-chain rather than accepting them from the series creator.
///      Series creation is permissionless in (strike, expiry), so a creator-supplied symbol would
///      be a way to mislabel a series. Deriving it removes that entirely.
library DateLib {
    uint256 private constant SECONDS_PER_DAY = 86400;

    /// @notice Civil date from days since the unix epoch.
    /// @dev Howard Hinnant's civil_from_days. Valid for any timestamp at or after 1970-01-01.
    function toCivil(uint256 timestamp) internal pure returns (uint256 year, uint256 month, uint256 day) {
        unchecked {
            uint256 z = timestamp / SECONDS_PER_DAY + 719468;
            uint256 era = z / 146097;
            uint256 doe = z - era * 146097;
            uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
            uint256 y = yoe + era * 400;
            uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
            uint256 mp = (5 * doy + 2) / 153;
            day = doy - (153 * mp + 2) / 5 + 1;
            month = mp < 10 ? mp + 3 : mp - 9;
            year = y + (month <= 2 ? 1 : 0);
        }
    }

    /// @notice "26SEP26" for 26 September 2026.
    function toTag(uint256 timestamp) internal pure returns (string memory) {
        (uint256 y, uint256 m, uint256 d) = toCivil(timestamp);
        return string.concat(_two(d), _month(m), _two(y % 100));
    }

    function _two(uint256 v) private pure returns (string memory) {
        bytes memory b = new bytes(2);
        b[0] = bytes1(uint8(48 + (v / 10) % 10));
        b[1] = bytes1(uint8(48 + v % 10));
        return string(b);
    }

    function _month(uint256 m) private pure returns (string memory) {
        string[13] memory names =
            ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        return names[m];
    }
}
