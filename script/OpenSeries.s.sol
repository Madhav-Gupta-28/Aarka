// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {TestStockToken} from "../src/testnet/TestStockToken.sol";
import {TestAggregator} from "../src/testnet/TestAggregator.sol";

/// @notice Adds a second stock to the testnet deployment and opens a fresh set of series on both.
///
/// @dev The first deployment only carried NVDA, and every series it opened has now expired. This
///      gives the testnet a live board again: two stocks, two strikes each, three expiries.
///
///      TSLA gets its own stand-in token and feed, seeded with the real mainnet Chainlink TSLA
///      price. From then on script/mirror-feeds.sh keeps both feeds tracking mainnet.
///
///        forge script script/OpenSeries.s.sol --rpc-url robinhood_testnet --broadcast \
///          --private-key $PRIVATE_KEY --sig "run(int256)" <TSLA_PRICE_8DP>
contract OpenSeries is Script {
    AarkaFactory constant FACTORY = AarkaFactory(0xE47d91B64f4CcAf9943E6EE1F2b97053722BA0C0);
    address constant NVDA = 0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1;

    // Fridays, 16:00 America/New_York, from NyseCalendar2026 and already published on-chain.
    uint64 constant SEP25 = 1790366400;
    uint64 constant OCT02 = 1790971200;
    uint64 constant OCT30 = 1793390400; // outlives the Founder House week

    function run(int256 tslaPrice) external {
        vm.startBroadcast();
        address deployer = msg.sender;

        TestStockToken tsla = new TestStockToken("Tesla - Aarka Testnet", "TSLA", deployer);
        TestAggregator tslaFeed = new TestAggregator("RHTSLA / USD", tslaPrice, deployer);
        FACTORY.registerAsset(address(tsla), AggregatorV3Interface(address(tslaFeed)));
        tsla.mint(deployer, 1_000_000e18);

        uint64[3] memory expiries = [SEP25, OCT02, OCT30];
        address[12] memory opened;
        uint256 k;
        for (uint256 i; i < 3; ++i) {
            // Strikes either side of spot on 15 Sep 2026: NVDA $211.93, TSLA $356.78.
            opened[k++] = FACTORY.createSeries(NVDA, 210e8, expiries[i]);
            opened[k++] = FACTORY.createSeries(NVDA, 230e8, expiries[i]);
            opened[k++] = FACTORY.createSeries(address(tsla), 350e8, expiries[i]);
            opened[k++] = FACTORY.createSeries(address(tsla), 400e8, expiries[i]);
        }

        vm.stopBroadcast();

        console.log("TSLA stand-in   ", address(tsla));
        console.log("TSLA feed       ", address(tslaFeed));
        for (uint256 i; i < 12; ++i) {
            AarkaSeries s = AarkaSeries(opened[i]);
            console.log(s.floorToken().symbol(), s.strike() / 1e8, opened[i]);
        }
    }
}
