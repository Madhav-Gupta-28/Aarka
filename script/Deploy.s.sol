// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {ExpiryCalendar} from "../src/ExpiryCalendar.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";

/// @notice Deploys the calendar and factory.
///
/// @dev The sequencer uptime feed is zero because Chainlink has not published one for Robinhood
///      Chain. See ARCHITECTURE.md appendix A.3 — this is a documented gap on their side, and the
///      series emits SequencerCheckDisabled so the missing guard is visible on-chain rather than
///      buried here. Set it with setSequencerFeed the moment an address exists.
///
///      forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast
contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("DEPLOYER_ADDRESS");

        vm.startBroadcast();
        ExpiryCalendar calendar = new ExpiryCalendar(owner);
        AarkaFactory factory = new AarkaFactory(owner, calendar, AggregatorV3Interface(address(0)));
        vm.stopBroadcast();

        console.log("ExpiryCalendar:", address(calendar));
        console.log("AarkaFactory:  ", address(factory));
    }
}

/// @notice Chainlink feed proxies on Robinhood Chain mainnet (chain 4663), resolved from
///         reference-data-directory.vercel.app/feeds-robinhood-mainnet.json on 2026-08-29.
///         All 35 equity feeds: 8 decimals, 86400s heartbeat, 0.5% deviation, us_equities_24/5.
library RobinhoodFeeds {
    address internal constant NVDA = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address internal constant TSLA = 0x4A1166a659A55625345e9515b32adECea5547C38;
    address internal constant AAPL = 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0;
    address internal constant MSFT = 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E;
    address internal constant AMZN = 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C;
    address internal constant GOOGL = 0xF6f373a037c30F0e5010d854385cA89185AE638b;
    address internal constant META = 0x7C38C00C30BEe9378381E7B6135d7283356D71b1;
    address internal constant GME = 0x27C71df6A64fB476468EdF256CF72c038baB5B67;
    address internal constant COIN = 0xA3a468A452940B7D6b69991207B508c609a98Ef2;
    address internal constant MSTR = 0x396118bdFB181e6240E74D243F266B061c0edc3D;
    address internal constant PLTR = 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c;
    address internal constant SPY = 0x319724394D3A0e3669269846abE664Cd621f9f6A;
    address internal constant QQQ = 0x80901d846d5D7B030F26B480776EE3b29374C2ae;
    address internal constant USDG = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
}
