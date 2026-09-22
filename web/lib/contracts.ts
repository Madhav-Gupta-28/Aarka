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
  /** Where a first visit lands: NVDA $210, 30 Oct 2026, the longest-dated NVDA market. */
  flagshipSeries: "0x7D31f372d747EDB24dB9242d5e48Cf68aA8dBdcF",
  nvda: "0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1",
  feed: "0x6a985039287dC8BB054C36804eb75337f69f944F",
  tsla: "0x06002571803D40bD20C13Bd835BE30a642623dEA",
  tslaFeed: "0x883dA473862A33e32BCdfb5Cf0aA22b0571781Ab",
  usdg: "0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097",
  hookLens: "0x414326E556667b5AE9931F67cDb267D1BAF7D1D0",
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
} as const;

/**
 * Every series with a market, and the parity hook bound to it. A hook is bound to one series at
 * construction, so each market is its own hook plus a pool for each half. Keys are lowercase.
 *
 * Redeployed 22 Sep 2026 with the AUDIT-24 sizing fix, all fifteen series this time. Every market
 * opened at 0 bps against a stock pool realigned to the mirrored Chainlink price.
 */
export const MARKETS: Record<string, `0x${string}`> = {
  "0xdfb1acfaa87eaf10136242c3f273fe4cea606ac7": "0x4A5AFd38edB9B00F8e668c9Ca8270f4696fbC040", // NVDA $210 · 25 Sep
  "0xbc25a8f80b30622aacfeefa054dc44125c1cd9e7": "0x4ED10b89A0c37efDA6d8473A4CB2c81836aB0040", // NVDA $230 · 25 Sep
  "0x46a335b9611d6e542f7dc6339097c90b7804881a": "0xc1c6720e95E70B51Bbb605101273216DEf7a4040", // TSLA $350 · 25 Sep
  "0x2b51ed3125cf98262b1c9bf075b81371315c29af": "0x029E9Fa2ef97c2D56A1DA76eCD089807af2DC040", // TSLA $400 · 25 Sep
  "0xce14497468dfcfba0dfad442af8561d2f956e4e7": "0x5e8C54dd0ed38bFb7b610e200FEE4741e6AEc040", // NVDA $210 · 2 Oct
  "0x81105a4a2d74cb353655469c815f55d392ceabb7": "0xF964F74F6c9E9E50024ce3b69d695A0ECd6e4040", // NVDA $230 · 2 Oct
  "0xcc0dde80ce590e2092f00cf5b82016ffd17163f4": "0x697e9F586C5cbf2A8b04fc1A3199fe60d16A0040", // TSLA $350 · 2 Oct
  "0xcb18e35ec23b9595ca8752d5ffea09cffd5e1a87": "0x1E11c14a6A2EadA61Ca024c1514B2DaFBC7A8040", // TSLA $400 · 2 Oct
  "0x7d31f372d747edb24db9242d5e48cf68aa8dbdcf": "0xFd7Ac12730eFAE6e0B4e7e5Beb29780989D04040", // NVDA $210 · 30 Oct
  "0x13b5ea7eeafcfabef731a97f4410e5db941a4819": "0x198296A48A6695064d0eb3c6ac384DFfE477C040", // NVDA $230 · 30 Oct
  "0xa34968cdb62a753aff8b3e172a931e1c76706e3e": "0x18362F957046037EEe5E640067658cd96B338040", // TSLA $350 · 30 Oct
  "0x9f755706bf8d5cdce4bae8e96e0d7b4942536f89": "0x5BD834aad040ca50707Ed5fF69701DE1697f8040", // TSLA $400 · 30 Oct
  "0xdf4f52a5158567a357e91ca6e5d39e111dcfbffb": "0x0a7154C1FdABeCb18f3B7CF216264BDa19e88040", // NVDA $210 · 6 Nov
  "0x3c3166b3aaa1fde7349818e7df6d19fc9079f6c0": "0x7F75Ec34366D6373480c65b983AdEA9310df0040", // NVDA $230 · 6 Nov
  "0xb6253f080eca3de2ff6c4c0ad1bcacbad2f3d28b": "0xF1c210002bFC398dEC493BF5Eeb86B597f4F4040", // TSLA $350 · 6 Nov
};

/**
 * Hooks from the previous deployment, still on chain and still holding their history.
 *
 * A hook is bound to one series at construction, so replacing the hook replaces the market but not
 * the series. The parity log reads these too: what the mechanism has done is a fact about the
 * protocol, not about whichever set of hooks is current. Superseded 22 Sep 2026 by the AUDIT-24
 * sizing fix.
 */
export const LEGACY_MARKETS: Record<string, `0x${string}`> = {
  "0xdfb1acfaa87eaf10136242c3f273fe4cea606ac7": "0x533f1ee34100eFF09031D3d5DE802d290dBc0040",
  "0xbc25a8f80b30622aacfeefa054dc44125c1cd9e7": "0x39aC5d768D0Dd32c1Fd133391308aC638A89c040",
  "0x46a335b9611d6e542f7dc6339097c90b7804881a": "0x6de83EC68484355746F205B9A822785d7e714040",
  "0x2b51ed3125cf98262b1c9bf075b81371315c29af": "0xce07DfbeE7254c08E773dd7C04a7A7e444B54040",
  "0xce14497468dfcfba0dfad442af8561d2f956e4e7": "0x7fbd3d2aA2285cee5014bce41584F1A288C94040",
  "0x81105a4a2d74cb353655469c815f55d392ceabb7": "0x794bb110Bfb78CEeF57d859FfC29103770478040",
  "0xcc0dde80ce590e2092f00cf5b82016ffd17163f4": "0x9b11f7704dAd01428d6D477623696b3821E00040",
  "0xcb18e35ec23b9595ca8752d5ffea09cffd5e1a87": "0x06a5881b0a358E779b1f9bA81b6d9d64bbea0040",
  "0x7d31f372d747edb24db9242d5e48cf68aa8dbdcf": "0x553f8d548b85b078152A6901fA19bEa19D8a0040",
  "0x13b5ea7eeafcfabef731a97f4410e5db941a4819": "0x086AA3fd893EE5CEcea6eBFaFd5b5dDaa5874040",
  "0xa34968cdb62a753aff8b3e172a931e1c76706e3e": "0x578Ed50250440813887Db1723E8bb8d04F804040",
  "0x9f755706bf8d5cdce4bae8e96e0d7b4942536f89": "0x3B14541fc6D434CA29a0f5575F0881d7974F0040",
};

export const marketFor = (series: string) => MARKETS[series.toLowerCase()];

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

/** The pool trading `asset` against USDG, carrying that series' parity hook. */
export function hookedPoolKey(asset: `0x${string}`, hook: `0x${string}`) {
  const quote = ADDRESSES.usdg as `0x${string}`;
  const assetIsZero = asset.toLowerCase() < quote.toLowerCase();
  return {
    key: {
      currency0: assetIsZero ? asset : quote,
      currency1: assetIsZero ? quote : asset,
      fee: POOL_FEE, tickSpacing: TICK_SPACING, hooks: hook,
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

export const HOOK_ABI = [
  {type: "event", name: "ParityRestored", inputs: [
    {name: "minted", type: "bool", indexed: false},
    {name: "size", type: "uint256", indexed: false},
    {name: "profit", type: "uint256", indexed: false}]},
  {type: "function", name: "minDeviationBps", stateMutability: "view", inputs: [],
   outputs: [{type: "uint256"}]},
  {type: "function", name: "maxArbSize", stateMutability: "view", inputs: [],
   outputs: [{type: "uint256"}]},
] as const;

export const SERIES_EVENTS_ABI = [
  {type: "event", name: "Minted", inputs: [
    {name: "by", type: "address", indexed: true},
    {name: "to", type: "address", indexed: true},
    {name: "amount", type: "uint256", indexed: false}]},
  {type: "event", name: "Redeemed", inputs: [
    {name: "by", type: "address", indexed: true},
    {name: "to", type: "address", indexed: true},
    {name: "amount", type: "uint256", indexed: false}]},
  {type: "event", name: "Settled", inputs: [
    {name: "roundId", type: "uint80", indexed: true},
    {name: "price", type: "uint256", indexed: false},
    {name: "updatedAt", type: "uint256", indexed: false},
    {name: "floorPayout", type: "uint256", indexed: false}]},
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
