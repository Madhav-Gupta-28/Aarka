// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {AarkaFactory} from "../src/AarkaFactory.sol";
import {AarkaSeries} from "../src/AarkaSeries.sol";
import {ExpiryCalendar} from "../src/ExpiryCalendar.sol";
import {AggregatorV3Interface} from "../src/interfaces/IExternal.sol";
import {StreamsAggregator, IVerifierProxy} from "../src/adapters/StreamsAggregator.sol";
import {MockVerifierProxy} from "./StreamsAggregator.t.sol";

/// @notice Aarka against the real X Layer, on real tokenized NVIDIA.
///
/// @dev Robinhood Chain testnet has no stock tokens, so everything there runs on stand-ins. X Layer
///      has the real thing: NVDAx, issued by Backed, with real supply. These tests fork X Layer
///      mainnet and run the protocol against it.
///
///      Only the verifier is mocked, and only because Chainlink has not published the Data Streams
///      verifier address for this chain. Everything else — the token, the sequencer feed, the
///      decimals, the supply — is what is actually deployed.
///
///        forge test --match-path test/XLayerFork.t.sol --fork-url https://rpc.xlayer.tech
interface IVerifierProxyMeta {
    function typeAndVersion() external view returns (string memory);
    function s_feeManager() external view returns (address);
}

interface IBackedToken {
    function minter() external view returns (address);
    function mint(address to, uint256 amount) external;
}

contract XLayerForkTest is Test {
    address constant NVDAX = 0xc845b2894dBddd03858fd2D643B4eF725fE0849d;
    address constant USDC = 0x74b7F16337b8972027F6196A17a631aC6dE26d22;
    address constant SEQUENCER_UPTIME = 0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9;
    address constant V4_POOL_MANAGER = 0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32;
    address constant BTC_USD_FEED = 0x4D6f6488a2B3a5f7b088f276887f608a1e9805c4;
    address constant VERIFIER_PROXY = 0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7;

    bytes32 constant NVDA_REGULAR = bytes32(uint256(0x0b01));
    bytes32 constant NVDA_OVERNIGHT = bytes32(uint256(0x0b03));

    uint64 constant EXPIRY = 1_793_390_400; // Fri 30 Oct 2026, 16:00 ET
    uint256 constant STRIKE = 210e8;

    address owner = makeAddr("owner");
    address holder = makeAddr("holder");

    MockVerifierProxy verifier;
    StreamsAggregator feed;
    AarkaFactory factory;
    ExpiryCalendar calendar;

    function setUp() public {
        verifier = new MockVerifierProxy();

        bytes32[] memory streams = new bytes32[](2);
        streams[0] = NVDA_REGULAR;
        streams[1] = NVDA_OVERNIGHT;
        feed = new StreamsAggregator(IVerifierProxy(address(verifier)), streams, "NVDA / USD");

        calendar = new ExpiryCalendar(owner);
        // The sequencer feed is real, and live. This is the first deployment where that guard runs.
        factory = new AarkaFactory(owner, calendar, AggregatorV3Interface(SEQUENCER_UPTIME));

        vm.startPrank(owner);
        uint64[] memory dates = new uint64[](1);
        dates[0] = EXPIRY;
        calendar.addExpiries(dates);
        factory.registerAsset(NVDAX, AggregatorV3Interface(address(feed)));
        vm.stopPrank();
    }

    function _submit(int192 mid18, uint32 observedAt, uint32 status) internal {
        feed.submit(
            abi.encode(
                StreamsAggregator.ReportV11({
                    feedId: NVDA_REGULAR, validFromTimestamp: observedAt, observationsTimestamp: observedAt,
                    nativeFee: 0, linkFee: 0, expiresAt: observedAt + 1 days, mid: mid18,
                    lastSeenTimestampNs: uint64(observedAt) * 1e9, bid: mid18, bidVolume: 1e18,
                    ask: mid18, askVolume: 1e18, lastTradedPrice: mid18, marketStatus: status
                })
            )
        );
    }

    /// @notice What X Layer actually provides, checked rather than assumed.
    function test_chainFacts() public view {
        assertEq(IERC20Metadata(NVDAX).symbol(), "NVDAx");
        assertEq(IERC20Metadata(NVDAX).decimals(), 18, "the hook prices three pools against one quote");
        assertGt(IERC20(NVDAX).totalSupply(), 1_000e18, "real supply, not a stand-in");
        assertEq(IERC20Metadata(USDC).decimals(), 6);
        assertGt(V4_POOL_MANAGER.code.length, 20_000, "Uniswap v4 is deployed here");

        // Robinhood Chain publishes no sequencer uptime feed. X Layer does.
        (, int256 up, uint256 startedAt,,) = AggregatorV3Interface(SEQUENCER_UPTIME).latestRoundData();
        assertEq(up, 0, "sequencer reported up");
        assertLt(startedAt, block.timestamp - 1 hours, "and up for longer than the grace period");

        assertEq(AggregatorV3Interface(BTC_USD_FEED).decimals(), 8, "push feeds exist, just not for equities");

        // The equity price has to come from Data Streams, so the verifier is the load-bearing
        // dependency. It is deployed, and its fee manager is zero: verification is billed by
        // subscription, so `verify(payload, "")` carries no value. That is what the adapter does.
        assertEq(IVerifierProxyMeta(VERIFIER_PROXY).typeAndVersion(), "VerifierProxy 2.0.0");
        assertEq(IVerifierProxyMeta(VERIFIER_PROXY).s_feeManager(), address(0), "subscription billing");
        assertGt(VERIFIER_PROXY.code.length, 1000);

        console.log("NVDAx supply:", IERC20(NVDAX).totalSupply() / 1e18);
        console.log("sequencer up since:", startedAt);
    }

    /// @notice Create a series on real NVDAx, split it, settle it, claim it.
    function test_theWholeLifecycleOnRealTokenizedNvidia() public {
        _submit(211.93e18, uint32(block.timestamp - 10 minutes), 2);

        address s = factory.createSeries(NVDAX, STRIKE, EXPIRY);
        AarkaSeries series = AarkaSeries(s);
        assertEq(series.floorToken().symbol(), "fNVDAx-210-30OCT26");
        assertEq(address(series.sequencerUptime()), SEQUENCER_UPTIME, "the guard is wired, not disabled");

        // Backed's token keeps a minter role. Funding through it, in a fork, is closer to reality
        // than writing a balance into storage — and `deal` cannot write this token's layout anyway.
        address minter = IBackedToken(NVDAX).minter();
        vm.prank(minter);
        IBackedToken(NVDAX).mint(holder, 50e18);
        vm.startPrank(holder);
        IERC20(NVDAX).approve(s, type(uint256).max);
        series.mint(50e18, holder);
        vm.stopPrank();

        // NVDAx moves one wei less than it is sent: Backed's token carries a scaling factor, and
        // the conversion rounds down. Aarka mints against the balance it actually received rather
        // than the amount requested, so the vault and the halves agree to the wei regardless.
        uint256 split = series.floorToken().balanceOf(holder);
        assertApproxEqAbs(split, 50e18, 2, "one wei of the underlying's own rounding");
        assertEq(IERC20(NVDAX).balanceOf(s), split, "the vault holds exactly what was split");
        assertEq(series.upsideToken().balanceOf(holder), split);

        // The upside is sold on; the floor holder is now alone and depends on settlement.
        address upside = address(series.upsideToken());
        vm.prank(holder);
        IERC20(upside).transfer(owner, split);

        _submit(240e18, uint32(EXPIRY - 20 minutes), 2);
        vm.warp(EXPIRY + 1);
        series.settle(2);
        assertEq(series.settlementPrice(), 240e8);
        assertFalse(series.settledLate());

        vm.warp(block.timestamp + series.CHALLENGE_PERIOD());
        vm.prank(holder);
        uint256 toFloor = series.claimFloor(split, holder);
        vm.prank(owner);
        uint256 toUpside = series.claimUpside(split, owner);

        // min(S,K)/S is 210/240, so the floor keeps seven eighths and the upside the rest.
        assertEq(toFloor, split * 875 / 1000);
        // Each payout transfer loses the same wei to the token's own rounding, which is the
        // underlying's behaviour and not the vault's: the vault paid out its whole balance.
        assertApproxEqAbs(toFloor + toUpside, split, 3, "every token accounted for");
        assertLe(IERC20(NVDAX).balanceOf(s), 3, "only the underlying's own rounding dust is left");
        assertEq(series.floorToken().totalSupply(), 0);
        console.log("split       :", split);
        console.log("floor leg   :", toFloor);
        console.log("upside leg  :", toUpside);
    }

    /// @notice The sequencer guard is not decoration here: settlement refuses while it is down.
    function test_settlementRefusesWhileTheSequencerIsDown() public {
        _submit(211.93e18, uint32(block.timestamp - 10 minutes), 2);
        address s = factory.createSeries(NVDAX, STRIKE, EXPIRY);
        AarkaSeries series = AarkaSeries(s);

        _submit(240e18, uint32(EXPIRY - 20 minutes), 2);
        vm.warp(EXPIRY + 1);

        // Chainlink's L2 pattern: a non-zero answer means the sequencer is down.
        vm.mockCall(
            SEQUENCER_UPTIME,
            abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
            abi.encode(uint80(1), int256(1), block.timestamp - 10 minutes, block.timestamp - 10 minutes, uint80(1))
        );
        vm.expectRevert(AarkaSeries.SequencerDown.selector);
        series.settle(2);

        vm.clearMockedCalls();
        series.settle(2);
        assertTrue(series.settled());
    }
}
