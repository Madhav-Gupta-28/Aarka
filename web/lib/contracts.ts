/// Deployed on Robinhood Chain testnet (46630).
///
/// Testnet carries neither Robinhood stock tokens nor Chainlink feeds — both mainnet addresses
/// return zero bytecode there — so the stock token and the price feed are stand-ins that
/// reproduce the real contracts' behaviour, quirks included. Everything else is the real protocol.
export const ADDRESSES = {
  factory: "0xE47d91B64f4CcAf9943E6EE1F2b97053722BA0C0",
  lens: "0xB3cAcd3770D0474d5aD8ba83D68A31C78E94adb2",
  calendar: "0x111040a3CfA607EF19693A023b157e9f806C622b",
  hook: "0x8524C561D2Ac10095775c6C2F6172a0DF8490040",
  /** The one series the parity hook arbitrages: NVDA $210, 30 Oct 2026. */
  hookSeries: "0xdB04d1652e2556b459cb57BB15fB1D95689c993b",
  nvda: "0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1",
  feed: "0x6a985039287dC8BB054C36804eb75337f69f944F",
  tsla: "0x06002571803D40bD20C13Bd835BE30a642623dEA",
  tslaFeed: "0x883dA473862A33e32BCdfb5Cf0aA22b0571781Ab",
  usdg: "0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097",
  hookLens: "0x414326E556667b5AE9931F67cDb267D1BAF7D1D0",
  swapRouter: "0x83b5D54866A826426f4E413b668B587c052Ab824",
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
} as const;

export const LENS_ABI = [
  {
    type: "function",
    name: "allSeries",
    stateMutability: "view",
    inputs: [],
    outputs: [{
      type: "tuple[]",
      components: [
        {name: "series", type: "address"},
        {name: "status", type: "uint8"},
        {name: "underlying", type: "address"},
        {name: "underlyingSymbol", type: "string"},
        {name: "strike", type: "uint256"},
        {name: "expiry", type: "uint64"},
        {name: "feed", type: "address"},
        {name: "floorToken", type: "address"},
        {name: "floorSymbol", type: "string"},
        {name: "upsideToken", type: "address"},
        {name: "upsideSymbol", type: "string"},
        {name: "spotPrice", type: "uint256"},
        {name: "spotUpdatedAt", type: "uint256"},
        {name: "priceValid", type: "bool"},
        {name: "oraclePaused", type: "bool"},
        {name: "settled", type: "bool"},
        {name: "settlementPrice", type: "uint256"},
        {name: "floorPayoutPerUnit", type: "uint256"},
        {name: "upsidePayoutPerUnit", type: "uint256"},
        {name: "claimsUnlockAt", type: "uint64"},
        {name: "totalDeposited", type: "uint256"},
        {name: "halfSupply", type: "uint256"},
      ],
    }],
  },
  {
    type: "function",
    name: "positionsOf",
    stateMutability: "view",
    inputs: [{name: "holder", type: "address"}],
    outputs: [{
      type: "tuple[]",
      components: [
        {name: "series", type: "address"},
        {name: "underlyingBalance", type: "uint256"},
        {name: "underlyingAllowance", type: "uint256"},
        {name: "floorBalance", type: "uint256"},
        {name: "upsideBalance", type: "uint256"},
        {name: "redeemable", type: "uint256"},
        {name: "floorClaimable", type: "uint256"},
        {name: "upsideClaimable", type: "uint256"},
      ],
    }],
  },
] as const;

export const SERIES_ABI = [
  {type: "function", name: "mint", stateMutability: "nonpayable",
   inputs: [{name: "amount", type: "uint256"}, {name: "to", type: "address"}], outputs: []},
  {type: "function", name: "redeem", stateMutability: "nonpayable",
   inputs: [{name: "amount", type: "uint256"}, {name: "to", type: "address"}], outputs: []},
  {type: "function", name: "claimFloor", stateMutability: "nonpayable",
   inputs: [{name: "amount", type: "uint256"}, {name: "to", type: "address"}],
   outputs: [{name: "paid", type: "uint256"}]},
  {type: "function", name: "claimUpside", stateMutability: "nonpayable",
   inputs: [{name: "amount", type: "uint256"}, {name: "to", type: "address"}],
   outputs: [{name: "paid", type: "uint256"}]},
  {type: "function", name: "settle", stateMutability: "nonpayable",
   inputs: [{name: "roundId", type: "uint80"}], outputs: []},
  {type: "function", name: "claimsUnlockAt", stateMutability: "view", inputs: [],
   outputs: [{type: "uint64"}]},
  {type: "function", name: "CHALLENGE_PERIOD", stateMutability: "view", inputs: [],
   outputs: [{type: "uint256"}]},
] as const;

export const HOOK_LENS_ABI = [
  {
    type: "function", name: "parity", stateMutability: "view",
    inputs: [{name: "hook", type: "address"}],
    outputs: [{
      type: "tuple",
      components: [
        {name: "hook", type: "address"},
        {name: "series", type: "address"},
        {name: "quote", type: "address"},
        {name: "underlyingPrice", type: "uint256"},
        {name: "floorPrice", type: "uint256"},
        {name: "upsidePrice", type: "uint256"},
        {name: "sumOfHalves", type: "uint256"},
        {name: "gapBps", type: "uint256"},
        {name: "halvesDear", type: "bool"},
        {name: "underlyingLiquidity", type: "uint128"},
        {name: "floorLiquidity", type: "uint128"},
        {name: "upsideLiquidity", type: "uint128"},
        {name: "minDeviationBps", type: "uint256"},
        {name: "maxArbSize", type: "uint256"},
        {name: "wired", type: "bool"},
      ],
    }],
  },
] as const;

export const TOKEN_ABI = [
  {type: "function", name: "balanceOf", stateMutability: "view",
   inputs: [{name: "a", type: "address"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "approve", stateMutability: "nonpayable",
   inputs: [{name: "spender", type: "address"}, {name: "amount", type: "uint256"}],
   outputs: [{type: "bool"}]},
  {type: "function", name: "allowance", stateMutability: "view",
   inputs: [{name: "o", type: "address"}, {name: "s", type: "address"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: []},
  {type: "function", name: "lastClaimed", stateMutability: "view",
   inputs: [{name: "a", type: "address"}], outputs: [{type: "uint256"}]},
] as const;

export enum Status { Open, Expired, Challenging, Claimable }

export const STATUS_LABEL: Record<number, string> = {
  0: "Open",
  1: "Awaiting settlement",
  2: "Settling",
  3: "Claimable",
};
