import {publicClient} from "./client";
import {ADDRESSES, LENS_ABI} from "./contracts";
import type {Position, SeriesView} from "./types";

const PAGE = 25n;

export type {Position, SeriesView};

/**
 * Read every series a page at a time. The lens's one-shot `allSeries` walks the whole list in a
 * single call, and since anyone can create series that call eventually stops fitting (AUDIT-19).
 */
export async function readSeries(): Promise<SeriesView[]> {
  const out: SeriesView[] = [];
  for (let offset = 0n; ; offset += PAGE) {
    const page = (await publicClient.readContract({
      address: ADDRESSES.lens as `0x${string}`, abi: LENS_ABI, functionName: "seriesPage",
      args: [offset, PAGE],
    })) as unknown as SeriesView[];
    out.push(...page);
    if (BigInt(page.length) < PAGE) return out;
  }
}

export async function readPositions(holder: `0x${string}`): Promise<Position[]> {
  const out: Position[] = [];
  for (let offset = 0n; ; offset += PAGE) {
    const page = (await publicClient.readContract({
      address: ADDRESSES.lens as `0x${string}`, abi: LENS_ABI, functionName: "positionsPage",
      args: [holder, offset, PAGE],
    })) as unknown as Position[];
    out.push(...page);
    if (BigInt(page.length) < PAGE) return out;
  }
}

/** A settled series whose halves have all been claimed has nothing left to show anyone. */
export const isFinished = (s: SeriesView) => s.status === 3 && s.halfSupply === 0n;

export const findSeries = (rows: SeriesView[] | null, address?: string) =>
  rows?.find((s) => s.series.toLowerCase() === address?.toLowerCase());
