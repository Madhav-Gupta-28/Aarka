// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AarkaLens} from "../src/AarkaLens.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {ExpiryCalendar} from "../src/ExpiryCalendar.sol";
import {AarkaRouter} from "../src/periphery/AarkaRouter.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

/// @notice Redeploys the protocol on Robinhood Chain testnet after AUDIT-16 and AUDIT-17.
///
/// @dev Both fixes live in `AarkaSeries` bytecode, and the factory embeds that bytecode, so a new
///      factory is the only way to ship them. Existing series keep working on the old factory and
///      their settlement history stays on chain; nothing here touches them.
///
///      Reused, because none of them changed: the expiry calendar, both stand-in stock tokens, both
///      mirrored feeds, the quote asset and HookLens. New: factory, lens and router.
///
///        forge script script/Redeploy.s.sol --rpc-url robinhood_testnet --broadcast \
///          --private-key $PRIVATE_KEY
contract Redeploy is Script {
    ExpiryCalendar constant CALENDAR = ExpiryCalendar(0x111040a3CfA607EF19693A023b157e9f806C622b);
    IPoolManager constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);

    address constant NVDA = 0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1;
    address constant NVDA_FEED = 0x6a985039287dC8BB054C36804eb75337f69f944F;
    address constant TSLA = 0x06002571803D40bD20C13Bd835BE30a642623dEA;
    address constant TSLA_FEED = 0x883dA473862A33e32BCdfb5Cf0aA22b0571781Ab;

    uint64 constant SEP25 = 1790366400;
    uint64 constant OCT02 = 1790971200;
    uint64 constant OCT30 = 1793390400;

    function run() external {
        vm.startBroadcast();
        address deployer = msg.sender;

        AarkaFactory factory = new AarkaFactory(deployer, CALENDAR, AggregatorV3Interface(address(0)));
        factory.registerAsset(NVDA, AggregatorV3Interface(NVDA_FEED));
        factory.registerAsset(TSLA, AggregatorV3Interface(TSLA_FEED));

        AarkaLens lens = new AarkaLens(factory);
        AarkaRouter router = new AarkaRouter(POOL_MANAGER, factory);

        uint64[3] memory expiries = [SEP25, OCT02, OCT30];
        address[12] memory opened;
        uint256 k;
        for (uint256 i; i < 3; ++i) {
            opened[k++] = factory.createSeries(NVDA, 210e8, expiries[i]);
            opened[k++] = factory.createSeries(NVDA, 230e8, expiries[i]);
            opened[k++] = factory.createSeries(TSLA, 350e8, expiries[i]);
            opened[k++] = factory.createSeries(TSLA, 400e8, expiries[i]);
        }
        vm.stopBroadcast();

        console.log("AarkaFactory  ", address(factory));
        console.log("AarkaLens     ", address(lens));
        console.log("AarkaRouter   ", address(router));
        for (uint256 i; i < 12; ++i) {
            console.log(AarkaSeries(opened[i]).floorToken().symbol(), opened[i]);
        }
    }
}
