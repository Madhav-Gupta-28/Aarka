/// Deployed on Robinhood Chain testnet (46630).
///
/// Testnet carries neither Robinhood stock tokens nor Chainlink feeds — both mainnet addresses
/// return zero bytecode there — so the stock token and the price feed are stand-ins that
/// reproduce the real contracts' behaviour, quirks included. Everything else is the real protocol.
export const ADDRESSES = {
  factory: "0xE47d91B64f4CcAf9943E6EE1F2b97053722BA0C0",
  lens: "0xB3cAcd3770D0474d5aD8ba83D68A31C78E94adb2",
  calendar: "0x111040a3CfA607EF19693A023b157e9f806C622b",
  hook: "0x309E90054c22b601D0393811e4b31FEaCC7A4040",
  nvda: "0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1",
  feed: "0x6a985039287dC8BB054C36804eb75337f69f944F",
  usdg: "0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097",
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
] as const;

export const TOKEN_ABI = [
  {type: "function", name: "balanceOf", stateMutability: "view",
   inputs: [{name: "a", type: "address"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "approve", stateMutability: "nonpayable",
   inputs: [{name: "spender", type: "address"}, {name: "amount", type: "uint256"}],
   outputs: [{type: "bool"}]},
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
