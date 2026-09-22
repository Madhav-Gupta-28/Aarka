/** One row of `AarkaLens.seriesPage` — everything the site knows about a series in one read. */
export type SeriesView = {
  series: `0x${string}`;
  status: number;
  underlying: `0x${string}`;
  underlyingSymbol: string;
  strike: bigint;
  expiry: bigint;
  feed: `0x${string}`;
  floorToken: `0x${string}`;
  floorSymbol: string;
  upsideToken: `0x${string}`;
  upsideSymbol: string;
  spotPrice: bigint;
  spotUpdatedAt: bigint;
  priceValid: boolean;
  oraclePaused: boolean;
  settled: boolean;
  settlementPrice: bigint;
  floorPayoutPerUnit: bigint;
  upsidePayoutPerUnit: bigint;
  claimsUnlockAt: bigint;
  totalDeposited: bigint;
  halfSupply: bigint;
};

/** One row of `AarkaLens.positionsPage`, for the connected wallet. */
export type Position = {
  series: `0x${string}`;
  underlyingBalance: bigint;
  underlyingAllowance: bigint;
  floorBalance: bigint;
  upsideBalance: bigint;
  redeemable: bigint;
  floorClaimable: bigint;
  upsideClaimable: bigint;
};

export const STATUS = {Open: 0, Expired: 1, Challenging: 2, Claimable: 3} as const;
