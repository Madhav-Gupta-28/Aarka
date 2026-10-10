"use client";

import {useQuery} from "@tanstack/react-query";
import {publicClient} from "./client";
import {n8} from "./format";

/**
 * The price path The Sun has published, read straight from the feed: the earliest round it still
 * holds, the latest, and evenly spaced rounds in between. On this testnet the feeds carry the
 * real prices from mid-September onwards, so "the past" is the last few weeks.
 */

const AGG = [
  {type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
   outputs: [{type: "uint80"}, {type: "int256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint80"}]},
  {type: "function", name: "getRoundData", stateMutability: "view", inputs: [{name: "id", type: "uint80"}],
   outputs: [{type: "uint80"}, {type: "int256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint80"}]},
] as const;

export type Point = {at: number; price: number};

async function round(feed: `0x${string}`, id: bigint): Promise<Point | null> {
  try {
    const [, price, , at] = (await publicClient.readContract({address: feed, abi: AGG, functionName: "getRoundData", args: [id]})) as unknown as [bigint, bigint, bigint, bigint];
    return price > 0n && at > 0n ? {at: Number(at), price: n8(price)} : null;
  } catch { return null; }
}

export function useHistory(feed?: `0x${string}`, samples = 32) {
  return useQuery({
    queryKey: ["history", feed, samples],
    enabled: !!feed,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Point[]> => {
      const [latest] = (await publicClient.readContract({address: feed!, abi: AGG, functionName: "latestRoundData"})) as unknown as [bigint];
      // The earliest round the feed still answers for: a binary search, since old ids revert.
      let lo = latest - 2000n < 1n ? 1n : latest - 2000n, hi = latest;
      if (await round(feed!, lo)) hi = lo;
      else {
        while (hi - lo > 1n) {
          const mid = (lo + hi) / 2n;
          if (await round(feed!, mid)) hi = mid; else lo = mid;
        }
      }
      const first = hi;
      const span = latest - first;
      const ids = Array.from({length: samples}, (_, i) => first + (span * BigInt(i)) / BigInt(samples - 1));
      const pts = (await Promise.all(ids.map((id) => round(feed!, id)))).filter((p): p is Point => !!p);
      return pts.sort((a, b) => a.at - b.at);
    },
  });
}
