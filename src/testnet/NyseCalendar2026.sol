// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title NyseCalendar2026
/// @notice The expiry timestamps Aarka publishes to its ExpiryCalendar.
///
/// @dev Every entry is 16:00 America/New_York on a day the NYSE is open, converted to UTC with
///      the IANA database rather than by hand. That matters: 16:00 ET is 20:00 UTC under EDT and
///      21:00 UTC under EST, so a hard-coded UTC cadence silently drifts by an hour twice a year.
///      The boundary is visible in this list — Fri 30 Oct 2026 is 20:00 UTC and Fri 06 Nov 2026
///      is 21:00 UTC.
///
///      Fridays, with the standard shift to Thursday when the Friday is a market holiday:
///        Fri 25 Dec 2026 (Christmas)  -> Thu 24 Dec 2026
///        Fri 01 Jan 2027 (New Year)   -> Thu 31 Dec 2026
///        Fri 26 Mar 2027 (Good Friday)-> Thu 25 Mar 2027
///
///      Generated from the NYSE observance rules, not transcribed. Regenerate for later years.
library NyseCalendar2026 {
    /// @notice 52 expiries, 04 Sep 2026 to 27 Aug 2027.
    function expiries() internal pure returns (uint64[] memory e) {
        e = new uint64[](52);
        e[0] = 1788552000; // Fri 04 Sep 2026 16:00 EDT
        e[1] = 1789156800; // Fri 11 Sep 2026 16:00 EDT
        e[2] = 1789761600; // Fri 18 Sep 2026 16:00 EDT
        e[3] = 1790366400; // Fri 25 Sep 2026 16:00 EDT
        e[4] = 1790971200; // Fri 02 Oct 2026 16:00 EDT
        e[5] = 1791576000; // Fri 09 Oct 2026 16:00 EDT
        e[6] = 1792180800; // Fri 16 Oct 2026 16:00 EDT
        e[7] = 1792785600; // Fri 23 Oct 2026 16:00 EDT
        e[8] = 1793390400; // Fri 30 Oct 2026 16:00 EDT
        e[9] = 1793998800; // Fri 06 Nov 2026 16:00 EST
        e[10] = 1794603600; // Fri 13 Nov 2026 16:00 EST
        e[11] = 1795208400; // Fri 20 Nov 2026 16:00 EST
        e[12] = 1795813200; // Fri 27 Nov 2026 16:00 EST
        e[13] = 1796418000; // Fri 04 Dec 2026 16:00 EST
        e[14] = 1797022800; // Fri 11 Dec 2026 16:00 EST
        e[15] = 1797627600; // Fri 18 Dec 2026 16:00 EST
        e[16] = 1798146000; // Thu 24 Dec 2026 16:00 EST
        e[17] = 1798750800; // Thu 31 Dec 2026 16:00 EST
        e[18] = 1799442000; // Fri 08 Jan 2027 16:00 EST
        e[19] = 1800046800; // Fri 15 Jan 2027 16:00 EST
        e[20] = 1800651600; // Fri 22 Jan 2027 16:00 EST
        e[21] = 1801256400; // Fri 29 Jan 2027 16:00 EST
        e[22] = 1801861200; // Fri 05 Feb 2027 16:00 EST
        e[23] = 1802466000; // Fri 12 Feb 2027 16:00 EST
        e[24] = 1803070800; // Fri 19 Feb 2027 16:00 EST
        e[25] = 1803675600; // Fri 26 Feb 2027 16:00 EST
        e[26] = 1804280400; // Fri 05 Mar 2027 16:00 EST
        e[27] = 1804885200; // Fri 12 Mar 2027 16:00 EST
        e[28] = 1805486400; // Fri 19 Mar 2027 16:00 EDT
        e[29] = 1806004800; // Thu 25 Mar 2027 16:00 EDT
        e[30] = 1806696000; // Fri 02 Apr 2027 16:00 EDT
        e[31] = 1807300800; // Fri 09 Apr 2027 16:00 EDT
        e[32] = 1807905600; // Fri 16 Apr 2027 16:00 EDT
        e[33] = 1808510400; // Fri 23 Apr 2027 16:00 EDT
        e[34] = 1809115200; // Fri 30 Apr 2027 16:00 EDT
        e[35] = 1809720000; // Fri 07 May 2027 16:00 EDT
        e[36] = 1810324800; // Fri 14 May 2027 16:00 EDT
        e[37] = 1810929600; // Fri 21 May 2027 16:00 EDT
        e[38] = 1811534400; // Fri 28 May 2027 16:00 EDT
        e[39] = 1812139200; // Fri 04 Jun 2027 16:00 EDT
        e[40] = 1812744000; // Fri 11 Jun 2027 16:00 EDT
        e[41] = 1813262400; // Thu 17 Jun 2027 16:00 EDT
        e[42] = 1813953600; // Fri 25 Jun 2027 16:00 EDT
        e[43] = 1814558400; // Fri 02 Jul 2027 16:00 EDT
        e[44] = 1815163200; // Fri 09 Jul 2027 16:00 EDT
        e[45] = 1815768000; // Fri 16 Jul 2027 16:00 EDT
        e[46] = 1816372800; // Fri 23 Jul 2027 16:00 EDT
        e[47] = 1816977600; // Fri 30 Jul 2027 16:00 EDT
        e[48] = 1817582400; // Fri 06 Aug 2027 16:00 EDT
        e[49] = 1818187200; // Fri 13 Aug 2027 16:00 EDT
        e[50] = 1818792000; // Fri 20 Aug 2027 16:00 EDT
        e[51] = 1819396800; // Fri 27 Aug 2027 16:00 EDT
    }
}
