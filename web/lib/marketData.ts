import {decodeEventLog} from "viem";
import {publicClient} from "./client";
import {ADDRESSES, HOOK_LENS_ABI, HOOK_ABI, LEGACY_MARKETS, MARKETS, marketFor} from "./contracts";
import {BLOCKS_PER_DAY} from "./chain";
import type {SeriesView} from "./types";

/** What `HookLens.parity` returns: the three pool prices and how far apart the halves have drifted. */
export type Parity = {
  hook: `0x${string}`;
  series: `0x${string}`;
  quote: `0x${string}`;
  underlyingPrice: bigint;
  floorPrice: bigint;
  upsidePrice: bigint;
  sumOfHalves: bigint;
  gapBps: bigint;
  halvesDear: boolean;
  underlyingLiquidity: bigint;
  floorLiquidity: bigint;
  upsideLiquidity: bigint;
  minDeviationBps: bigint;
  maxArbSize: bigint;
  wired: boolean;
};

/**
 * Read every market's parity in one round trip.
 *
 * Fifteen markets means fifteen `parity` calls, and doing them one at a time makes the chain view
 * visibly crawl in. Multicall3 is at its canonical address on this chain, so viem batches them into
 * a single `eth_call`. Failures are tolerated per market: one unwired hook must not blank the page.
 */
export async function readParity(hooks: readonly `0x${string}`[]): Promise<Map<string, Parity>> {
  if (hooks.length === 0) return new Map();
  const results = await publicClient.multicall({
    contracts: hooks.map((hook) => ({
      address: ADDRESSES.hookLens as `0x${string}`,
      abi: HOOK_LENS_ABI,
      functionName: "parity" as const,
      args: [hook] as const,
    })),
    allowFailure: true,
  });

  const out = new Map<string, Parity>();
  results.forEach((r, i) => {
    if (r.status !== "success" || !r.result) return;
    const p = r.result as unknown as Parity;
    if (!p.wired) return;
    out.set(hooks[i].toLowerCase(), p);
  });
  return out;
}

/** Every market, keyed by the series it belongs to rather than by its hook. */
export async function readParityBySeries(): Promise<Map<string, Parity>> {
  const hooks = Object.values(MARKETS);
  const byHook = await readParity(hooks);
  const out = new Map<string, Parity>();
  byHook.forEach((p) => out.set(p.series.toLowerCase(), p));
  return out;
}

export type ArbEvent = {
  hook: `0x${string}`;
  /** True when the hook that did this has since been replaced. */
  retired: boolean;
  series?: `0x${string}`;
  minted: boolean;
  size: bigint;
  profit: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
};

/**
 * Every time the hook has closed a gap, newest first.
 *
 * This is the one number that proves the mechanism rather than describing it: an amount of stock
 * the hook minted or redeemed, and the cash it handed to the liquidity providers for doing it.
 * The window is wide because testnet traffic is sparse — a day of blocks here is about 430,000.
 */
export async function readArbHistory(days = 4n): Promise<ArbEvent[]> {
  // Superseded hooks are read too. Swapping a hook replaces the market, not the series, and what
  // the mechanism has actually done is a fact about the protocol rather than about whichever
  // deployment happens to be current.
  const seriesOf = new Map<string, `0x${string}`>();
  [MARKETS, LEGACY_MARKETS].forEach((set) =>
    Object.entries(set).forEach(([series, hook]) =>
      seriesOf.set(hook.toLowerCase(), series as `0x${string}`)));
  const current = new Set(Object.values(MARKETS).map((h) => h.toLowerCase()));
  const hooks = [...Object.values(MARKETS), ...Object.values(LEGACY_MARKETS)];

  const latest = await publicClient.getBlockNumber();
  const span = BLOCKS_PER_DAY * days;
  const fromBlock = latest > span ? latest - span : 0n;

  const logs = await publicClient.getLogs({
    address: hooks,
    event: HOOK_ABI[0],
    fromBlock,
    toBlock: "latest",
  });

  return logs
    .map((log) => {
      const {args} = decodeEventLog({abi: HOOK_ABI, data: log.data, topics: log.topics});
      const a = args as unknown as {minted: boolean; size: bigint; profit: bigint};
      return {
        hook: log.address as `0x${string}`,
        retired: !current.has(log.address.toLowerCase()),
        series: seriesOf.get(log.address.toLowerCase()),
        minted: a.minted,
        size: a.size,
        profit: a.profit,
        blockNumber: log.blockNumber!,
        txHash: log.transactionHash!,
      };
    })
    .sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

/** Headline numbers for the landing page, all derived from data already on screen elsewhere. */
export function protocolStats(series: SeriesView[]) {
  const live = series.filter((s) => s.status === 0);
  const deposited = series.reduce((acc, s) => acc + s.totalDeposited, 0n);
  const outstanding = series.reduce((acc, s) => acc + s.halfSupply, 0n);
  const tradable = series.filter((s) => !!marketFor(s.series)).length;
  const settled = series.filter((s) => s.settled).length;
  const underlyings = new Set(series.map((s) => s.underlyingSymbol));
  return {live: live.length, total: series.length, deposited, outstanding, tradable, settled,
          underlyings: underlyings.size};
}
