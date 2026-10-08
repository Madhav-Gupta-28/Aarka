// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {MainnetBase} from "./MainnetBase.t.sol";
import {BrokenFeed} from "./StandIns.sol";
import {AarkaSeries} from "../../../src/AarkaSeries.sol";
import {AarkaToken} from "../../../src/AarkaToken.sol";
import {AarkaFactory} from "../../../src/AarkaFactory.sol";
import {ExpiryCalendar} from "../../../src/ExpiryCalendar.sol";
import {AggregatorV3Interface} from "../../../src/interfaces/IExternal.sol";

/// @notice Series creation on real mainnet: every rule the factory enforces, with the issuer's
///         real pause and corporate-action roles, real Chainlink feeds of every shape, and USDG as
///         a real token that implements none of the ERC-8056 signals.
contract MainnetFactoryTest is MainnetBase {
    /// @dev Real Chainlink feeds on Robinhood Chain mainnet, from the official directory.
    address constant USDG_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2; // USDG / USD, 8 decimals
    address constant SYRUP_RATE_FEED = 0x6317f016FA3e312C4625dee51d32b43a223011f8; // 18 decimals

    function setUp() public {
        _forkA();
    }

    // ------------------------------------------------------------------ governance

    function test_onlyTheOwnerGoverns() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.registerAsset(AAPL, AggregatorV3Interface(AAPL_FEED));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.setSequencerFeed(AggregatorV3Interface(address(0)));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.setCreationPaused(true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        calendar.addExpiries(new uint64[](0));
        vm.stopPrank();
    }

    /// @dev Two real Chainlink feeds a careless owner could register: an 18-decimal exchange rate
    ///      and a sequencer feed (0 decimals). Neither prices a stock in 8 decimals.
    function test_registerAssetRefusesFeedsOfTheWrongShape() public {
        vm.startPrank(owner);
        vm.expectRevert(AarkaFactory.UnexpectedFeedDecimals.selector);
        factory.registerAsset(AAPL, AggregatorV3Interface(SYRUP_RATE_FEED));
        vm.expectRevert(AarkaFactory.UnexpectedFeedDecimals.selector);
        factory.registerAsset(AAPL, AggregatorV3Interface(address(sequencer)));

        vm.expectEmit(true, true, true, true);
        emit AarkaFactory.AssetRegistered(NVDA, AAPL_FEED, NVDA_FEED);
        factory.registerAsset(NVDA, AggregatorV3Interface(AAPL_FEED)); // repoint, and say from what
        vm.stopPrank();
    }

    function test_pauseAndSequencerSettings() public {
        vm.prank(owner);
        factory.setCreationPaused(true);
        vm.expectRevert(AarkaFactory.CreationPaused.selector);
        _create(NVDA, 230e8);

        vm.startPrank(owner);
        factory.setCreationPaused(false);
        factory.setSequencerFeed(AggregatorV3Interface(address(0)));
        vm.stopPrank();
        AarkaSeries s = _create(NVDA, 230e8);
        assertEq(address(s.sequencerUptime()), address(0), "series take the feed set at creation");
    }

    // ------------------------------------------------------------------ creation guards

    function test_unregisteredAssetsCannotBeWritten() public {
        vm.expectRevert(AarkaFactory.AssetNotRegistered.selector);
        _create(AAPL, 250e8);
    }

    /// @dev Stand-in: a feed registered with 8 decimals that later reports 18.
    function test_aFeedThatChangesDecimalsStopsCreation() public {
        BrokenFeed f = new BrokenFeed();
        f.push(1, 230e8, block.timestamp);
        vm.prank(owner);
        factory.registerAsset(AAPL, AggregatorV3Interface(address(f)));
        f.setDecimals(18);
        vm.expectRevert(AarkaFactory.UnexpectedFeedDecimals.selector);
        _create(AAPL, 230e8);
    }

    function test_strikesMustBeWholeCentsAndBounded() public {
        vm.expectRevert(AarkaFactory.InvalidStrike.selector);
        _create(NVDA, 0);
        vm.expectRevert(AarkaFactory.InvalidStrike.selector);
        _create(NVDA, 1e18 + 1e6);
        vm.expectRevert(AarkaFactory.InvalidStrike.selector);
        _create(NVDA, 230e8 + 1); // a fraction of a cent
    }

    function test_expiriesMustBePublishedAndInRange() public {
        vm.expectRevert(AarkaFactory.InvalidExpiry.selector);
        factory.createSeries(NVDA, 230e8, CLOSE_2OCT + 1);

        uint64[] memory dates = new uint64[](2);
        dates[0] = uint64(block.timestamp + 12 hours);
        dates[1] = uint64(block.timestamp + 366 days);
        vm.prank(owner);
        calendar.addExpiries(dates);

        vm.expectRevert(AarkaFactory.TenorTooShort.selector);
        factory.createSeries(NVDA, 230e8, dates[0]);
        vm.expectRevert(AarkaFactory.TenorTooLong.selector);
        factory.createSeries(NVDA, 230e8, dates[1]);
    }

    /// @dev Real spot is about $232. The band is a fifth of it to five times it.
    function test_strikesOutsideTheBandAreRefused() public {
        uint256 spot = _spot(NVDA_FEED);
        vm.expectRevert(AarkaFactory.StrikeOutOfBand.selector);
        _create(NVDA, (spot / 5 - 1e8) / 1e6 * 1e6);
        vm.expectRevert(AarkaFactory.StrikeOutOfBand.selector);
        _create(NVDA, (spot * 5 + 1e8) / 1e6 * 1e6);
        _create(NVDA, (spot / 5 + 1e6) / 1e6 * 1e6); // just inside
    }

    /// @dev The real feed's last round dated after the block (clock wound back) and more than four
    ///      days old (clock wound forward): both make spot unusable for the band check.
    function test_spotMustBeFreshAndNotFromTheFuture() public {
        (,,, uint256 at,) = AggregatorV3Interface(NVDA_FEED).latestRoundData();
        uint256 now_ = block.timestamp;

        vm.warp(at - 1);
        vm.expectRevert(AarkaFactory.SpotUnavailable.selector);
        _create(NVDA, 230e8);

        vm.warp(at + 4 days + 1);
        uint64[] memory dates = new uint64[](1);
        dates[0] = uint64(at + 9 days);
        vm.prank(owner);
        calendar.addExpiries(dates);
        vm.expectRevert(AarkaFactory.SpotUnavailable.selector);
        factory.createSeries(NVDA, 230e8, dates[0]);
        vm.warp(now_);
    }

    /// @dev Stand-in: a feed whose latest answer is zero.
    function test_aFeedWithNoPriceIsUnavailable() public {
        BrokenFeed f = new BrokenFeed();
        f.push(1, 0, block.timestamp);
        vm.prank(owner);
        factory.registerAsset(AAPL, AggregatorV3Interface(address(f)));
        vm.expectRevert(AarkaFactory.SpotUnavailable.selector);
        _create(AAPL, 230e8);
    }

    /// @dev The issuer's real oracle-pause role.
    function test_aPausedStockCannotBeWritten() public {
        vm.prank(ISSUER_ORACLE_PAUSER);
        IStock(NVDA).pauseOracle();
        vm.expectRevert(AarkaFactory.OraclePaused.selector);
        _create(NVDA, 230e8);
    }

    /// @dev The issuer's real multiplier role schedules a split before the close: no series may
    ///      be written across it. One after the close is no obstacle. And NVDA's effectiveAt is
    ///      already non-zero from the dividend it paid on 10 Sep, which must not block anything.
    function test_aScheduledCorporateActionBlocksOnlySeriesItFallsInside() public {
        assertGt(IStock(NVDA).effectiveAt(), 0, "NVDA carries a past action");
        assertLt(IStock(NVDA).effectiveAt(), block.timestamp);
        _create(NVDA, 230e8);

        vm.prank(ISSUER_MULTIPLIER);
        IStock(NVDA).updateMultiplier(2e18, CLOSE_2OCT + 1 days);
        _create(NVDA, 231e8); // after the close: fine

        vm.prank(ISSUER_MULTIPLIER);
        IStock(NVDA).updateMultiplier(2e18, CLOSE_2OCT - 1 days);
        vm.expectRevert(AarkaFactory.CorporateActionScheduled.selector);
        _create(NVDA, 232e8);
    }

    /// @dev USDG implements neither oraclePaused nor effectiveAt, and Chainlink publishes a real
    ///      USDG/USD feed. A series on it is created and settled with both probes simply absent.
    function test_aTokenWithoutTheIssuerSignalsIsNotGatedOnThem() public {
        vm.prank(owner);
        factory.registerAsset(USDG, AggregatorV3Interface(USDG_FEED));
        AarkaSeries s = AarkaSeries(factory.createSeries(USDG, 1e8, CLOSE_2OCT));
        assertFalse(s.hasOraclePause());
        assertEq(s.floorToken().symbol(), "fUSDG-1-02OCT26");
    }

    function test_eachTermsCanExistOnceAndTheAddressIsKnownInAdvance() public {
        address predicted = factory.predictSeries(NVDA, 230e8, CLOSE_2OCT);
        assertEq(factory.seriesFor(NVDA, 230e8, CLOSE_2OCT), predicted);
        address s = address(_create(NVDA, 230e8));
        assertEq(s, predicted);
        assertTrue(factory.isSeries(s));
        assertEq(factory.seriesCount(), 1);

        vm.expectRevert(AarkaFactory.SeriesExists.selector);
        _create(NVDA, 230e8);

        // Repointing the feed moves the prediction but never the record.
        vm.prank(owner);
        factory.registerAsset(NVDA, AggregatorV3Interface(AAPL_FEED));
        assertEq(factory.seriesFor(NVDA, 230e8, CLOSE_2OCT), s);
        assertTrue(factory.predictSeries(NVDA, 230e8, CLOSE_2OCT) != s);
        vm.expectRevert(AarkaFactory.SeriesExists.selector);
        _create(NVDA, 230e8);
    }

    // ------------------------------------------------------------------ names, every month

    /// @dev Series out to September 2027, so every month and both year-boundary branches of the
    ///      date formatting are exercised by real creations.
    function test_symbolsForEveryMonthOfTheYear() public {
        string[12] memory tags = [
            "15OCT26", "16NOV26", "15DEC26", "15JAN27", "16FEB27", "15MAR27",
            "15APR27", "17MAY27", "15JUN27", "15JUL27", "16AUG27", "15SEP27"
        ];
        uint64[12] memory at = [
            uint64(1792094400), 1794859200, 1797364800, 1800043200, 1802808000, 1805140800,
            1807819200, 1810584000, 1813089600, 1815681600, 1818446400, 1821038400
        ];
        uint64[] memory dates = new uint64[](12);
        for (uint256 i; i < 12; ++i) {
            dates[i] = at[i];
        }
        vm.prank(owner);
        calendar.addExpiries(dates);
        for (uint256 i; i < 12; ++i) {
            AarkaSeries s = AarkaSeries(factory.createSeries(NVDA, 212_500_000_00, at[i]));
            assertEq(s.floorToken().symbol(), string.concat("fNVDA-212.50-", tags[i]));
        }
    }

    // ------------------------------------------------------------------ calendar and token

    function test_calendarIsAddOnlyAndFutureOnly() public {
        uint64[] memory dates = new uint64[](1);
        dates[0] = CLOSE_2OCT;
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(ExpiryCalendar.AlreadyAdded.selector, CLOSE_2OCT));
        calendar.addExpiries(dates);
        dates[0] = uint64(block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(ExpiryCalendar.NotInFuture.selector, uint64(block.timestamp)));
        calendar.addExpiries(dates);
        vm.stopPrank();
    }

    function test_onlyTheSeriesMintsAndBurnsItsHalves() public {
        AarkaSeries s = _create(NVDA, 230e8);
        AarkaToken f = s.floorToken();
        assertEq(f.series(), address(s));
        vm.startPrank(alice);
        vm.expectRevert(AarkaToken.NotSeries.selector);
        f.mint(alice, 1);
        vm.expectRevert(AarkaToken.NotSeries.selector);
        f.burn(alice, 1);
        vm.stopPrank();
    }
}

interface IStock {
    function pauseOracle() external;
    function updateMultiplier(uint256 newMultiplier, uint256 effectiveAt) external;
    function effectiveAt() external view returns (uint256);
}
