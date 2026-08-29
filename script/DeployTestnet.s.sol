// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {ExpiryCalendar} from "../src/ExpiryCalendar.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {TestStockToken} from "../src/testnet/TestStockToken.sol";
import {TestAggregator} from "../src/testnet/TestAggregator.sol";
import {NyseCalendar2026} from "../src/testnet/NyseCalendar2026.sol";

/// @notice Deploys Aarka to Robinhood Chain testnet (46630), including the stand-ins that chain
///         requires. Testnet has neither Robinhood stock tokens nor Chainlink feeds — both mainnet
///         addresses return zero bytecode there — so this script deploys its own.
///
///         forge script script/DeployTestnet.s.sol \
///           --rpc-url robinhood_testnet --broadcast --private-key $PRIVATE_KEY
contract DeployTestnet is Script {
    int256 constant SPOT = 215e8; // $215.00, 8 decimals, matching a real equity feed

    function run() external {
        vm.startBroadcast();
        address deployer = msg.sender;

        // --- the two things Robinhood testnet does not provide -----------------
        TestStockToken nvda = new TestStockToken("NVIDIA - Aarka Testnet", "NVDA", deployer);
        TestAggregator feed = new TestAggregator("RHNVDA / USD", SPOT, deployer);

        // --- the protocol -------------------------------------------------------
        ExpiryCalendar calendar = new ExpiryCalendar(deployer);
        AarkaFactory factory =
            new AarkaFactory(deployer, calendar, AggregatorV3Interface(address(0)));

        // --- publish the calendar ----------------------------------------------
        // The calendar only accepts future timestamps, so drop any that have already passed.
        uint64[] memory all = NyseCalendar2026.expiries();
        uint256 n;
        for (uint256 i; i < all.length; ++i) {
            if (all[i] > block.timestamp) ++n;
        }
        uint64[] memory future = new uint64[](n);
        uint256 k;
        for (uint256 i; i < all.length; ++i) {
            if (all[i] > block.timestamp) future[k++] = all[i];
        }
        calendar.addExpiries(future);

        factory.registerAsset(address(nvda), AggregatorV3Interface(address(feed)));

        // --- open the first two series ------------------------------------------
        // Nearest expiry at least a week out, so there is room to demonstrate a lifecycle.
        uint64 expiry;
        for (uint256 i; i < future.length; ++i) {
            if (future[i] > block.timestamp + 7 days) {
                expiry = future[i];
                break;
            }
        }
        require(expiry != 0, "no usable expiry in the calendar");

        address atTheMoney = factory.createSeries(address(nvda), 215e8, expiry);
        address outOfTheMoney = factory.createSeries(address(nvda), 240e8, expiry);

        // Seed the deployer so there is something to mint with immediately.
        nvda.mint(deployer, 1_000_000e18);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Aarka on Robinhood Chain testnet (46630) ===");
        console.log("TestStockToken NVDA   ", address(nvda));
        console.log("TestAggregator feed   ", address(feed));
        console.log("ExpiryCalendar        ", address(calendar));
        console.log("AarkaFactory          ", address(factory));
        console.log("expiries published    ", future.length);
        console.log("");
        console.log("--- series ---");
        _logSeries("$215 strike", atTheMoney);
        _logSeries("$240 strike", outOfTheMoney);
    }

    function _logSeries(string memory label, address s) private view {
        AarkaSeries series = AarkaSeries(s);
        console.log(label, s);
        console.log("   floor ", series.floorToken().symbol(), address(series.floorToken()));
        console.log("   upside", series.upsideToken().symbol(), address(series.upsideToken()));
    }
}
