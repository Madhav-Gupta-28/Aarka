// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./Base.t.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {ExpiryCalendar} from "../src/ExpiryCalendar.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockStockToken, PlainToken, FeeOnTransferToken} from "./mocks/MockStockToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AarkaFactoryTest is BaseTest {
    uint64 constant EXPIRY2 = 1_790_971_200; // 2026-10-02 20:00 UTC, a Friday

    function _addExpiry(uint64 t) internal {
        uint64[] memory d = new uint64[](1);
        d[0] = t;
        vm.prank(owner);
        calendar.addExpiries(d);
    }

    // ---------------------------------------------------------------- addressing

    function test_seriesAddressIsDeterministic() public view {
        assertEq(factory.seriesFor(address(nvda), STRIKE, EXPIRY), address(series));
    }

    function test_duplicateSeriesReverts() public {
        vm.expectRevert(AarkaFactory.SeriesExists.selector);
        factory.createSeries(address(nvda), STRIKE, EXPIRY);
    }

    function test_creationIsPermissionless() public {
        _addExpiry(EXPIRY2);
        vm.prank(bob); // no privileges at all
        address s = factory.createSeries(address(nvda), 240e8, EXPIRY2);
        assertTrue(factory.isSeries(s));
        assertEq(factory.seriesCount(), 2);
    }

    // ---------------------------------------------------------------- the governed dimension

    /// @dev The security decision in the factory: a creator picks the strike and expiry, never
    ///      the feed. A series pointed at an attacker-controlled feed would drain the deposit.
    function test_cannotCreateSeriesForAnUnregisteredAsset() public {
        PlainToken other = new PlainToken("Other", "OTHER");
        _addExpiry(EXPIRY2);
        vm.expectRevert(AarkaFactory.AssetNotRegistered.selector);
        factory.createSeries(address(other), 240e8, EXPIRY2);
    }

    function test_onlyOwnerCanRegisterAnAsset() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        factory.registerAsset(address(nvda), AggregatorV3Interface(address(feed)));
    }

    function test_registeringRejectsAFeedWithWrongDecimals() public {
        MockAggregator bad = new MockAggregator();
        bad.setDecimals(18);
        vm.prank(owner);
        vm.expectRevert(AarkaFactory.UnexpectedFeedDecimals.selector);
        factory.registerAsset(address(nvda), AggregatorV3Interface(address(bad)));
    }

    /// @dev I7 / I8. Governance repointing an asset cannot reach a series that already exists.
    function test_repointingAFeedCannotTouchAnExistingSeries() public {
        MockAggregator evil = new MockAggregator();
        evil.pushRound(1, 1e8, NOW);
        vm.prank(owner);
        factory.registerAsset(address(nvda), AggregatorV3Interface(address(evil)));

        assertEq(address(series.feed()), address(feed), "existing series keeps its immutable feed");
    }

    // ---------------------------------------------------------------- creation guards

    function test_rejectsAnExpiryNotOnTheCalendar() public {
        vm.expectRevert(AarkaFactory.InvalidExpiry.selector);
        factory.createSeries(address(nvda), 240e8, EXPIRY + 1 days);
    }

    function test_rejectsATenorThatIsTooShort() public {
        uint64 soon = uint64(NOW + 1 hours);
        _addExpiry(soon);
        vm.expectRevert(AarkaFactory.TenorTooShort.selector);
        factory.createSeries(address(nvda), 240e8, soon);
    }

    function test_rejectsATenorThatIsTooLong() public {
        uint64 far = uint64(NOW + 400 days);
        _addExpiry(far);
        vm.expectRevert(AarkaFactory.TenorTooLong.selector);
        factory.createSeries(address(nvda), 240e8, far);
    }

    function test_rejectsAZeroStrike() public {
        _addExpiry(EXPIRY2);
        vm.expectRevert(AarkaFactory.InvalidStrike.selector);
        factory.createSeries(address(nvda), 0, EXPIRY2);
    }

    function test_rejectsAStrikeOutsideTheBand() public {
        _addExpiry(EXPIRY2);
        vm.expectRevert(AarkaFactory.StrikeOutOfBand.selector);
        factory.createSeries(address(nvda), 5000e8, EXPIRY2); // spot is 215
    }

    /// @dev ERC-8056 announces a corporate action before it lands, so a series can simply refuse
    ///      to be written across one.
    function test_rejectsWhenACorporateActionIsScheduledInsideTheTenor() public {
        _addExpiry(EXPIRY2);
        nvda.scheduleCorporateAction(2e18, EXPIRY2 - 1 days);
        vm.expectRevert(AarkaFactory.CorporateActionScheduled.selector);
        factory.createSeries(address(nvda), 240e8, EXPIRY2);
    }

    function test_allowsACorporateActionScheduledAfterExpiry() public {
        _addExpiry(EXPIRY2);
        nvda.scheduleCorporateAction(2e18, EXPIRY2 + 30 days);
        factory.createSeries(address(nvda), 240e8, EXPIRY2); // fine
    }

    function test_rejectsWhileTheOracleIsPaused() public {
        _addExpiry(EXPIRY2);
        nvda.setOraclePaused(true);
        vm.expectRevert(AarkaFactory.OraclePaused.selector);
        factory.createSeries(address(nvda), 240e8, EXPIRY2);
    }

    function test_rejectsAStaleSpotForTheBandCheck() public {
        _addExpiry(EXPIRY2);
        vm.warp(NOW + 10 days);
        vm.expectRevert(AarkaFactory.SpotUnavailable.selector);
        factory.createSeries(address(nvda), 240e8, EXPIRY2);
    }

    function test_creationCanBePausedByGovernance() public {
        _addExpiry(EXPIRY2);
        vm.prank(owner);
        factory.setCreationPaused(true);
        vm.expectRevert(AarkaFactory.CreationPaused.selector);
        factory.createSeries(address(nvda), 240e8, EXPIRY2);
    }

    // ---------------------------------------------------------------- optional interfaces

    /// @dev A token implementing none of the optional probes must still work.
    function test_worksWithATokenThatHasNoOptionalInterfaces() public {
        PlainToken plain = new PlainToken("Plain", "PLAIN");
        MockAggregator pf = new MockAggregator();
        pf.pushRound(1, 100e8, NOW - 60);

        _addExpiry(EXPIRY2);
        vm.prank(owner);
        factory.registerAsset(address(plain), AggregatorV3Interface(address(pf)));

        AarkaSeries s = AarkaSeries(factory.createSeries(address(plain), 100e8, EXPIRY2));
        assertFalse(s.hasOraclePause());
    }

    // ---------------------------------------------------------------- calendar

    function test_calendarIsAddOnly() public {
        _addExpiry(EXPIRY2);
        assertTrue(calendar.isValidExpiry(EXPIRY2));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ExpiryCalendar.AlreadyAdded.selector, EXPIRY2));
        uint64[] memory d = new uint64[](1);
        d[0] = EXPIRY2;
        calendar.addExpiries(d);
    }

    function test_calendarRejectsPastDates() public {
        uint64[] memory d = new uint64[](1);
        d[0] = uint64(NOW - 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ExpiryCalendar.NotInFuture.selector, d[0]));
        calendar.addExpiries(d);
    }

    // ---------------------------------------------------------------- odd tokens

    /// @dev Balance-delta accounting: a fee-on-transfer token must mint the received amount,
    ///      not the requested one, or the vault over-issues and breaks I1.
    function test_feeOnTransferTokenMintsTheObservedDelta() public {
        FeeOnTransferToken fot = new FeeOnTransferToken("Fee", "FEE");
        MockAggregator ff = new MockAggregator();
        ff.pushRound(1, 100e8, NOW - 60);

        _addExpiry(EXPIRY2);
        vm.prank(owner);
        factory.registerAsset(address(fot), AggregatorV3Interface(address(ff)));
        AarkaSeries s = AarkaSeries(factory.createSeries(address(fot), 100e8, EXPIRY2));

        fot.mint(alice, 1000e18);
        vm.startPrank(alice);
        fot.approve(address(s), type(uint256).max);
        s.mint(100e18, alice);
        vm.stopPrank();

        uint256 received = fot.balanceOf(address(s));
        assertEq(received, 99e18);
        assertEq(s.floorToken().balanceOf(alice), received, "supply must equal balance");
        assertEq(s.upsideToken().balanceOf(alice), received);
    }
}
