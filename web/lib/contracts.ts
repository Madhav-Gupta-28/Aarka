/// Deployed on Robinhood Chain testnet (46630).
///
/// Testnet carries neither Robinhood stock tokens nor Chainlink feeds — both mainnet addresses
/// return zero bytecode there — so the stock tokens and price feeds are stand-ins. The feeds carry
/// the real mainnet Chainlink prices, copied across by script/mirror-feeds.sh. Everything else is
/// the real protocol, redeployed on 15 Sep 2026 with the AUDIT-16 and AUDIT-17 fixes.
export const ADDRESSES = {
  factory: "0x69caa2b3d4f732861A36e78b5A3992d18faA9BcA",
  lens: "0xaE4f737b0f259b1C8A15a73367670090c94bB2d7",
  router: "0xe7C93E5b953a98F1601D469bFb30eE6f687c678a",
  calendar: "0x111040a3CfA607EF19693A023b157e9f806C622b",
  hook: "0x553f8d548b85b078152A6901fA19bEa19D8a0040",
  /** The series with a market: NVDA $210, 30 Oct 2026, the one the parity hook arbitrages. */
  hookSeries: "0x7D31f372d747EDB24dB9242d5e48Cf68aA8dBdcF",
  nvda: "0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1",
  feed: "0x6a985039287dC8BB054C36804eb75337f69f944F",
  tsla: "0x06002571803D40bD20C13Bd835BE30a642623dEA",
  tslaFeed: "0x883dA473862A33e32BCdfb5Cf0aA22b0571781Ab",
  usdg: "0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097",
  hookLens: "0x414326E556667b5AE9931F67cDb267D1BAF7D1D0",
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
} as const;

/** Every pool Aarka opens uses one fee tier; the hook and HookLens assume it too. */
export const POOL_FEE = 3000;
export const TICK_SPACING = 60;

const SERIES_VIEW = [
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
] as const;

const POSITION_VIEW = [
  {name: "series", type: "address"},
  {name: "underlyingBalance", type: "uint256"},
  {name: "underlyingAllowance", type: "uint256"},
  {name: "floorBalance", type: "uint256"},
  {name: "upsideBalance", type: "uint256"},
  {name: "redeemable", type: "uint256"},
  {name: "floorClaimable", type: "uint256"},
  {name: "upsideClaimable", type: "uint256"},
] as const;

/**
 * Only the paged reads. `allSeries` and `positionsOf` walk every series, and anyone can grow that
 * list, so the site never calls them (AUDIT-19).
 */
export const LENS_ABI = [
  {type: "function", name: "seriesPage", stateMutability: "view",
   inputs: [{name: "offset", type: "uint256"}, {name: "limit", type: "uint256"}],
   outputs: [{type: "tuple[]", components: SERIES_VIEW}]},
  {type: "function", name: "positionsPage", stateMutability: "view",
   inputs: [{name: "holder", type: "address"}, {name: "offset", type: "uint256"}, {name: "limit", type: "uint256"}],
   outputs: [{type: "tuple[]", components: POSITION_VIEW}]},
] as const;

const POOL_KEY = [
  {name: "currency0", type: "address"}, {name: "currency1", type: "address"},
  {name: "fee", type: "uint24"}, {name: "tickSpacing", type: "int24"}, {name: "hooks", type: "address"},
] as const;

export const ROUTER_ABI = [
  {type: "function", name: "splitAndSell", stateMutability: "nonpayable",
   inputs: [
     {name: "series", type: "address"}, {name: "sellUpside", type: "bool"}, {name: "amount", type: "uint256"},
     {name: "key", type: "tuple", components: POOL_KEY},
     {name: "minQuoteOut", type: "uint256"}, {name: "to", type: "address"}],
   outputs: [{name: "quoteOut", type: "uint256"}]},
  {type: "function", name: "swapExactIn", stateMutability: "nonpayable",
   inputs: [
     {name: "key", type: "tuple", components: POOL_KEY},
     {name: "zeroForOne", type: "bool"}, {name: "amountIn", type: "uint256"},
     {name: "minAmountOut", type: "uint256"}, {name: "to", type: "address"}],
   outputs: [{name: "amountOut", type: "uint256"}]},
] as const;

/** The pool trading `asset` against USDG, carrying the parity hook. */
export function hookedPoolKey(asset: `0x${string}`) {
  const quote = ADDRESSES.usdg as `0x${string}`;
  const assetIsZero = asset.toLowerCase() < quote.toLowerCase();
  return {
    key: {
      currency0: assetIsZero ? asset : quote,
      currency1: assetIsZero ? quote : asset,
      fee: POOL_FEE, tickSpacing: TICK_SPACING, hooks: ADDRESSES.hook as `0x${string}`,
    },
    assetIsZero,
  };
}

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
  {type: "function", name: "mint", stateMutability: "nonpayable",
   inputs: [{name: "to", type: "address"}, {name: "amount", type: "uint256"}], outputs: []},
] as const;

export enum Status { Open, Expired, Challenging, Claimable }

export const STATUS_LABEL: Record<number, string> = {
  0: "Open",
  1: "Awaiting settlement",
  2: "Settling",
  3: "Claimable",
};
