// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

/// @notice Runs against Robinhood Chain mainnet using the real Chainlink NVDA feed.
///
/// @dev This is the test a mock cannot replace. It validates the assumptions in ARCHITECTURE.md
///      against production data: real feed decimals, real round cadence, real updatedAt gaps and
///      the real composite roundId layout.
///
///      The underlying is still a mock, because Robinhood stock token addresses are open item 3.
///      The oracle path, which is where the risk lives, is entirely real.
///
///      Series are deployed directly rather than through the factory, because the factory
///      correctly refuses an expiry in the past and every usable historical round is in the past.
///
///      Run with:  forge test --match-path test/Fork.t.sol --fork-url robinhood
contract ForkTest is Test {
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    uint256 constant PHASE_1 = 1 << 64;

    AggregatorV3Interface feed = AggregatorV3Interface(NVDA_FEED);
    MockStockToken nvda;

    function setUp() public {
        vm.skip(block.chainid != 4663);
        nvda = new MockStockToken("Robinhood NVDA", "NVDA");
    }

    /// @notice The three properties ARCHITECTURE.md section 3.5 asserts about these feeds.
    function test_feedMatchesTheDocumentedShape() public view {
        assertEq(feed.decimals(), 8, "equity feeds are 8 decimals");
        assertEq(feed.description(), "RHNVDA / USD");

        (uint80 roundId, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertGt(answer, 0);
        assertGt(updatedAt, 0);
        assertGt(uint256(roundId), PHASE_1, "proxy round ids are (phaseId << 64) | aggregatorRound");

        console.log("latest aggregator round:", uint256(roundId) - PHASE_1);
        console.log("price (8dp):           ", uint256(answer));
        console.log("staleness (seconds):   ", block.timestamp - updatedAt);
    }

    /// @notice Settlement against a real historical round.
    function test_settlesAgainstARealRound() public {
        (uint80 latest,,,,) = feed.latestRoundData();
        uint80 target = latest - 30;

        (, int256 answer,, uint256 updatedAt,) = feed.getRoundData(target);
        (,,, uint256 nextUpdatedAt,) = feed.getRoundData(target + 1);
        assertGt(answer, 0);
        assertGt(nextUpdatedAt, updatedAt, "rounds advance in time");

        // Put expiry between the two rounds, so `target` is the last round at or before it.
        uint64 expiry = uint64(updatedAt + (nextUpdatedAt - updatedAt) / 2);
        assertLe(expiry - updatedAt, 6 hours, "gap must fit inside MAX_SETTLEMENT_LOOKBACK");

        AarkaSeries series = new AarkaSeries(
            IERC20(address(nvda)), feed, AggregatorV3Interface(address(0)), 230e8, expiry
        );

        vm.warp(expiry + 1);
        series.settle(target);

        assertTrue(series.settled());
        assertEq(series.settlementPrice(), uint256(answer));
        assertEq(series.settlementUpdatedAt(), updatedAt);
        assertEq(series.floorPayoutPerUnit() + series.upsidePayoutPerUnit(), 1e18);
    }

    /// @notice A round published after expiry is refused, on real data.
    function test_rejectsARealRoundPublishedAfterExpiry() public {
        (uint80 latest,,,,) = feed.latestRoundData();
        uint80 target = latest - 30;
        (,,, uint256 updatedAt,) = feed.getRoundData(target);

        uint64 expiry = uint64(updatedAt - 1);
        AarkaSeries series = new AarkaSeries(
            IERC20(address(nvda)), feed, AggregatorV3Interface(address(0)), 230e8, expiry
        );

        vm.warp(expiry + 1 hours);
        vm.expectRevert(AarkaSeries.RoundAfterExpiry.selector);
        series.settle(target);
    }

    /// @notice Presenting an early round to pick a better price is refused, on real data.
    function test_rejectsAnEarlyRoundWhenALaterOneExists() public {
        (uint80 latest,,,,) = feed.latestRoundData();
        uint80 early = latest - 30;
        (,,, uint256 earlyAt,) = feed.getRoundData(early);
        (,,, uint256 laterAt,) = feed.getRoundData(early + 2);

        uint64 expiry = uint64(laterAt + 60);
        AarkaSeries series = new AarkaSeries(
            IERC20(address(nvda)), feed, AggregatorV3Interface(address(0)), 230e8, expiry
        );

        vm.warp(expiry + 1);
        vm.expectRevert(AarkaSeries.LaterRoundExists.selector);
        series.settle(early);
        earlyAt;
    }

    /// @notice Measures the real cadence, which is what MAX_SETTLEMENT_LOOKBACK is derived from.
    function test_measureRoundGaps() public view {
        (uint80 latest,,,,) = feed.latestRoundData();
        uint256 maxGap;
        uint256 prev;
        for (uint80 i = latest - 60; i <= latest; ++i) {
            (,,, uint256 at,) = feed.getRoundData(i);
            if (at == 0) continue;
            if (prev != 0 && at - prev > maxGap) maxGap = at - prev;
            prev = at;
        }
        console.log("largest gap over the last 60 rounds (s):", maxGap);
        console.log("MAX_SETTLEMENT_LOOKBACK (s):           ", uint256(6 hours));
    }
}
