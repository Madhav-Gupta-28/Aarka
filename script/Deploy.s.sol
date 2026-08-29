// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

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

/// @notice Robinhood stock tokens on chain 4663. Every address below was verified on-chain on
///         2026-08-29 by calling symbol() and decimals(); all are 18 decimals and all implement
///         uiMultiplier(), oraclePaused() and effectiveAt().
library RobinhoodTokens {
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address internal constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address internal constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address internal constant AMZN = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;
    address internal constant GOOGL = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
    address internal constant META = 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35;
    address internal constant MSTR = 0xec262a75e413fAfD0dF80480274532C79D42da09;
    address internal constant COIN = 0x6330D8C3178a418788dF01a47479c0ce7CCF450b;
    address internal constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address internal constant QQQ = 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
}

/// @notice Uniswap v4 on Robinhood Chain. PoolManager is at the same address on mainnet (4663)
///         and testnet (46630), verified by bytecode length on both.
library UniswapV4 {
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant QUOTER = 0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
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
