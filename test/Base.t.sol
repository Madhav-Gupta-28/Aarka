// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AarkaToken} from "../src/AarkaToken.sol";
import {ExpiryCalendar} from "../src/ExpiryCalendar.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {MockAggregator, MockSequencerFeed} from "./mocks/MockAggregator.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

contract BaseTest is Test {
    uint256 constant NOW = 1_790_000_000; // 2026-09-21 15:33 UTC
    uint64 constant EXPIRY = 1_790_366_400; // 2026-09-25 20:00 UTC == 16:00 ET, a Friday
    uint256 constant STRIKE = 230e8; // $230.00
    uint256 constant ONE = 1e18;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    MockStockToken nvda;
    MockAggregator feed;
    MockSequencerFeed seq;
    ExpiryCalendar calendar;
    AarkaFactory factory;
    AarkaSeries series;
    AarkaToken f;
    AarkaToken u;

    function setUp() public virtual {
        vm.warp(NOW);

        nvda = new MockStockToken("Robinhood NVDA", "NVDA");
        feed = new MockAggregator();
        seq = new MockSequencerFeed();

        // Spot at creation, for the fat-finger band.
        feed.pushRound(100, 215e8, NOW - 60);

        calendar = new ExpiryCalendar(owner);
        factory = new AarkaFactory(owner, calendar, AggregatorV3Interface(address(seq)));

        vm.startPrank(owner);
        uint64[] memory dates = new uint64[](1);
        dates[0] = EXPIRY;
        calendar.addExpiries(dates);
        factory.registerAsset(address(nvda), AggregatorV3Interface(address(feed)));
        vm.stopPrank();

        series = AarkaSeries(factory.createSeries(address(nvda), STRIKE, EXPIRY));
        f = series.floorToken();
        u = series.upsideToken();

        nvda.mint(alice, 1_000e18);
        nvda.mint(bob, 1_000e18);
        vm.prank(alice);
        nvda.approve(address(series), type(uint256).max);
        vm.prank(bob);
        nvda.approve(address(series), type(uint256).max);
    }

    /// @dev Publish the round that settlement should pin, plus a later one after expiry.
    function _publishSettlementRounds(int256 price) internal {
        feed.pushRound(200, price, EXPIRY - 30 minutes);
        feed.pushRound(201, price + 5e8, EXPIRY + 10 minutes);
    }

    function _settleAt(int256 price) internal {
        _publishSettlementRounds(price);
        vm.warp(EXPIRY + 1);
        series.settle(200);
        vm.warp(EXPIRY + 1 + series.CHALLENGE_PERIOD());
    }
}
