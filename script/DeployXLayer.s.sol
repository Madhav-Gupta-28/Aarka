// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AarkaLens} from "../src/AarkaLens.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {ExpiryCalendar} from "../src/ExpiryCalendar.sol";
import {AarkaRouter} from "../src/periphery/AarkaRouter.sol";
import {StreamsAggregator, IVerifierProxy} from "../src/adapters/StreamsAggregator.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

/// @notice Deploys Aarka to X Layer, on real tokenized stocks.
///
/// @dev What X Layer provides, checked on chain rather than assumed:
///
///        NVDAx        real, issued by Backed, 45,246 supply, 18 decimals
///        Uniswap v4   the official PoolManager, same as Robinhood Chain
///        sequencer    an L2 uptime feed, live since Nov 2025 — Robinhood Chain has none,
///                     so this is the first deployment where that guard actually runs
///        prices       no equity push feeds at all; equities come from Chainlink Data Streams,
///                     which OKX brought to X Layer in June 2026
///
///      The price therefore arrives through `StreamsAggregator`: signed reports, verified on
///      chain, recorded as rounds. Everything above it — factory, vault, settlement, hook, router
///      — is the same audited code that runs on Robinhood Chain.
///
///        forge script script/DeployXLayer.s.sol --rpc-url xlayer --broadcast \
///          --private-key $PRIVATE_KEY
contract DeployXLayer is Script {
    address constant NVDAX = 0xc845b2894dBddd03858fd2D643B4eF725fE0849d;

    /// @notice Chainlink's Data Streams verifier on X Layer: `VerifierProxy 2.0.0`, with a zero
    ///         fee manager, meaning verification is billed by subscription rather than per report.
    address constant VERIFIER_PROXY = 0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7;
    address constant SEQUENCER_UPTIME = 0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9;
    IPoolManager constant POOL_MANAGER = IPoolManager(0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32);

    /// @notice NVDA / USD, RWA Advanced (v11). A 24/5 equity publishes one stream per trading
    ///         phase; all three describe the same security, so all three feed one history.
    bytes32 constant NVDA_REGULAR = 0x000b6aa036224454037bab103184565f6aa9ea589c3b349f6d8471ee753524b9;
    bytes32 constant NVDA_EXTENDED = 0x000bb043961643d051393c085a4dd0cded6f67b4b71e47e9dcec739b7b3e2145;
    bytes32 constant NVDA_OVERNIGHT = 0x000b47988e89f3e63e1d679c84b774e6c38bb9929ad9de6e5e56d657a80388a9;

    // NYSE closes, 16:00 America/New_York, from NyseCalendar2026.
    uint64 constant OCT30 = 1793390400;
    uint64 constant NOV27 = 1795813200;
    uint64 constant DEC18 = 1797627600;

    function run() external {
        vm.startBroadcast();
        address deployer = msg.sender;

        bytes32[] memory streams = new bytes32[](3);
        streams[0] = NVDA_REGULAR;
        streams[1] = NVDA_EXTENDED;
        streams[2] = NVDA_OVERNIGHT;
        StreamsAggregator feed =
            new StreamsAggregator(IVerifierProxy(VERIFIER_PROXY), streams, "NVDA / USD - Data Streams");

        ExpiryCalendar calendar = new ExpiryCalendar(deployer);
        uint64[] memory dates = new uint64[](3);
        dates[0] = OCT30;
        dates[1] = NOV27;
        dates[2] = DEC18;
        calendar.addExpiries(dates);

        // The sequencer feed is passed in rather than left at zero: X Layer publishes one.
        AarkaFactory factory =
            new AarkaFactory(deployer, calendar, AggregatorV3Interface(SEQUENCER_UPTIME));
        factory.registerAsset(NVDAX, AggregatorV3Interface(address(feed)));

        AarkaLens lens = new AarkaLens(factory);
        AarkaRouter router = new AarkaRouter(POOL_MANAGER, factory);

        vm.stopBroadcast();

        console.log("StreamsAggregator ", address(feed));
        console.log("ExpiryCalendar    ", address(calendar));
        console.log("AarkaFactory      ", address(factory));
        console.log("AarkaLens         ", address(lens));
        console.log("AarkaRouter       ", address(router));
        console.log("");
        console.log("Next: submit a report, then createSeries. A series cannot be created until the");
        console.log("aggregator holds a price, because the factory checks the strike against spot.");
    }
}
