"use client";

import {useQuery} from "@tanstack/react-query";
import {useAccount} from "wagmi";
import {publicClient} from "./client";
import {ADDRESSES, HOOK_LENS_ABI, TOKEN_ABI, marketFor} from "./contracts";
import {isFinished, readPositions, readSeries, type Position, type SeriesView} from "./lens";
import {reference} from "./pricing";
import {n18, n6, n8, nowSec} from "./format";

/** The feeds beat once a day; past that plus margin, a price is late. Mirrors MAX_SETTLEMENT_AGE. */
export const FRESH_SECONDS = 26 * 60 * 60;

export type Parity = {
  underlyingPrice: bigint; floorPrice: bigint; upsidePrice: bigint; sumOfHalves: bigint;
  gapBps: bigint; halvesDear: boolean; minDeviationBps: bigint; wired: boolean;
  quote: `0x${string}`; floorLiquidity: bigint; upsideLiquidity: bigint;
};

/** Every series anyone can still do something with, refreshed every 15 seconds. */
export function useSeries() {
  return useQuery({
    queryKey: ["series"],
    queryFn: async () => (await readSeries()).filter((r) => !isFinished(r)),
    refetchInterval: 15_000,
  });
}

export function useOneSeries(address?: string) {
  const q = useSeries();
  const s = q.data?.find((r) => r.series.toLowerCase() === address?.toLowerCase());
  return {...q, s};
}

/** Where a first visit lands: the flagship if it is still open, else the nearest open series. */
export function pickFeatured(rows?: SeriesView[]) {
  if (!rows?.length) return undefined;
  const flag = rows.find((r) => r.series.toLowerCase() === ADDRESSES.flagshipSeries.toLowerCase() && r.status === 0);
  if (flag) return flag;
  const open = rows.filter((r) => r.status === 0).sort((a, b) => Number(a.expiry - b.expiry));
  return open[0] ?? rows[0];
}

/** Market prices of both halves, for every open series that has pools. */
export function useParityAll(rows?: SeriesView[]) {
  const hooks = (rows ?? []).filter((r) => r.status === 0 && marketFor(r.series)).map((r) => [r.series, marketFor(r.series)!] as const);
  return useQuery({
    queryKey: ["parity", hooks.map(([s]) => s).join(",")],
    enabled: hooks.length > 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      const out: Record<string, Parity> = {};
      await Promise.all(hooks.map(async ([series, hook]) => {
        try {
          const p = (await publicClient.readContract({
            address: ADDRESSES.hookLens as `0x${string}`, abi: HOOK_LENS_ABI, functionName: "parity", args: [hook],
          })) as unknown as Parity;
          if (p.wired && p.floorPrice > 0n && p.upsidePrice > 0n) out[series.toLowerCase()] = p;
        } catch { /* a pool without liquidity reads as no market */ }
      }));
      return out;
    },
  });
}

export type Quote = {
  spot: number;
  strike: number;
  floor: number;
  upside: number;
  /** "market" when both pools have a price, "estimate" when it is the reference model. */
  source: "market" | "estimate";
  fresh: boolean;
};

/**
 * Today's price of one share and each half, in dollars.
 *
 * Halves are priced from their pools where they trade. Where they do not, the Black-Scholes
 * reference stands in and is labelled an estimate, because a blank is worse than a number that
 * says what it is.
 */
export function quoteFor(s: SeriesView, parity?: Record<string, Parity>): Quote {
  const spot = s.priceValid ? n8(s.spotPrice) : 0;
  const strike = n8(s.strike);
  const fresh = s.priceValid && nowSec() - Number(s.spotUpdatedAt) < FRESH_SECONDS;
  const p = parity?.[s.series.toLowerCase()];
  if (p) {
    return {spot, strike, floor: n6(p.floorPrice), upside: n6(p.upsidePrice), source: "market", fresh};
  }
  const r = reference(spot, strike, Number(s.expiry) - nowSec());
  return {spot, strike, floor: r.floor, upside: r.upside, source: "estimate", fresh};
}

/** One entry per underlying stock, with its live price. */
export function stocksOf(rows?: SeriesView[]) {
  const m = new Map<string, {symbol: string; spot: number; updatedAt: bigint; fresh: boolean; feed: `0x${string}`; token: `0x${string}`}>();
  for (const r of rows ?? []) {
    if (m.has(r.underlyingSymbol)) continue;
    m.set(r.underlyingSymbol, {
      symbol: r.underlyingSymbol,
      spot: r.priceValid ? n8(r.spotPrice) : 0,
      updatedAt: r.spotUpdatedAt,
      fresh: r.priceValid && nowSec() - Number(r.spotUpdatedAt) < FRESH_SECONDS,
      feed: r.feed,
      token: r.underlying,
    });
  }
  return [...m.values()];
}

export function usePositions() {
  const {address} = useAccount();
  return useQuery({
    queryKey: ["positions", address],
    enabled: !!address,
    refetchInterval: 12_000,
    queryFn: () => readPositions(address!),
  });
}

export type Balances = {
  share: bigint; floor: bigint; upside: bigint; cash: bigint;
  shareToSeries: bigint; shareToRouter: bigint; floorToRouter: bigint; upsideToRouter: bigint; cashToRouter: bigint;
};

/** Everything one wallet needs to act on one series: balances and every allowance in play. */
export function useBalances(s?: SeriesView) {
  const {address} = useAccount();
  return useQuery({
    queryKey: ["balances", address, s?.series],
    enabled: !!address && !!s,
    refetchInterval: 10_000,
    queryFn: async (): Promise<Balances> => {
      const router = ADDRESSES.router as `0x${string}`;
      const usdg = ADDRESSES.usdg as `0x${string}`;
      const bal = (t: `0x${string}`) => publicClient.readContract({address: t, abi: TOKEN_ABI, functionName: "balanceOf", args: [address!]}) as Promise<bigint>;
      const alw = (t: `0x${string}`, sp: `0x${string}`) => publicClient.readContract({address: t, abi: TOKEN_ABI, functionName: "allowance", args: [address!, sp]}) as Promise<bigint>;
      const [share, floor, upside, cash, shareToSeries, shareToRouter, floorToRouter, upsideToRouter, cashToRouter] = await Promise.all([
        bal(s!.underlying), bal(s!.floorToken), bal(s!.upsideToken), bal(usdg),
        alw(s!.underlying, s!.series), alw(s!.underlying, router), alw(s!.floorToken, router), alw(s!.upsideToken, router), alw(usdg, router),
      ]);
      return {share, floor, upside, cash, shareToSeries, shareToRouter, floorToRouter, upsideToRouter, cashToRouter};
    },
  });
}

/** The value of a position today and, if today's price were the final one, at the end. */
export function valuePosition(p: Position, s: SeriesView, q: Quote) {
  const f = n18(p.floorBalance), u = n18(p.upsideBalance);
  if (s.settled) {
    const px = n8(s.settlementPrice);
    const fPay = n18(p.floorClaimable) * px, uPay = n18(p.upsideClaimable) * px;
    return {today: fPay + uPay, ifEnd: fPay + uPay, floor: fPay, upside: uPay};
  }
  return {
    today: f * q.floor + u * q.upside,
    ifEnd: f * Math.min(q.spot, q.strike) + u * Math.max(q.spot - q.strike, 0),
    floor: f * q.floor,
    upside: u * q.upside,
  };
}

const AGG_ABI = [
  {type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
   outputs: [{type: "uint80"}, {type: "int256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint80"}]},
  {type: "function", name: "getRoundData", stateMutability: "view", inputs: [{name: "id", type: "uint80"}],
   outputs: [{type: "uint80"}, {type: "int256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint80"}]},
] as const;

export type Round = {id: bigint; price: number; at: number};

/** The last few prices The Sun published for one feed, newest first. */
export function useRounds(feed?: `0x${string}`, count = 5) {
  return useQuery({
    queryKey: ["rounds", feed, count],
    enabled: !!feed,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Round[]> => {
      const [latest] = (await publicClient.readContract({address: feed!, abi: AGG_ABI, functionName: "latestRoundData"})) as unknown as [bigint];
      const ids = Array.from({length: count}, (_, i) => latest - BigInt(i)).filter((id) => id > 0n);
      const rows = await Promise.all(ids.map(async (id) => {
        try {
          const [, price, , at] = (await publicClient.readContract({address: feed!, abi: AGG_ABI, functionName: "getRoundData", args: [id]})) as unknown as [bigint, bigint, bigint, bigint];
          return price > 0n && at > 0n ? {id, price: n8(price), at: Number(at)} : null;
        } catch { return null; }
      }));
      return rows.filter((r): r is Round => !!r);
    },
  });
}
