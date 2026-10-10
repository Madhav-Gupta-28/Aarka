"use client";

import {useQuery} from "@tanstack/react-query";
import {ADDRESSES, MARKETS} from "./contracts";
import type {SeriesView} from "./lens";
import {money, n8, qty, short} from "./format";

/**
 * What's happening on the chain, in words. Read from the block explorer's public API, which
 * decodes the events and answers in one request per contract (a raw log query on this chain is
 * capped at a few hours of blocks).
 *
 * The parity hooks show up as themselves: when a hook mints or redeems, that's The Scales
 * rebalancing, and it says so.
 */

const API = "https://explorer.testnet.chain.robinhood.com/api/v2/addresses";

export type Activity = {key: string; at: number; tx: string; who: string; text: string; kind: "split" | "join" | "sell" | "buy" | "scales" | "collect"};

type Log = {
  block_timestamp: string; transaction_hash: string; index: number; address: {hash: string};
  decoded?: {method_call: string; parameters: {name: string; value: string}[]};
};

async function logs(addr: string): Promise<Log[]> {
  const r = await fetch(`${API}/${addr}/logs`);
  if (!r.ok) return [];
  const j = await r.json();
  return j.items ?? [];
}

export function useActivity(rows?: SeriesView[]) {
  return useQuery({
    queryKey: ["activity", rows?.length],
    enabled: !!rows?.length,
    refetchInterval: 60_000,
    staleTime: 45_000,
    queryFn: async (): Promise<Activity[]> => {
      const series = (rows ?? []).filter((r) => MARKETS[r.series.toLowerCase()]);
      const hooks = new Set(Object.values(MARKETS).map((h) => h.toLowerCase()));
      const bySeries = new Map(series.map((s) => [s.series.toLowerCase(), s]));
      const byToken = new Map<string, {s: SeriesView; half: "Floor" | "Upside"}>();
      for (const s of rows ?? []) { byToken.set(s.floorToken.toLowerCase(), {s, half: "Floor"}); byToken.set(s.upsideToken.toLowerCase(), {s, half: "Upside"}); }
      const usdg = ADDRESSES.usdg.toLowerCase();
      const label = (s: SeriesView) => `${s.underlyingSymbol} $${Math.round(n8(s.strike))}`;

      const all = (await Promise.all([logs(ADDRESSES.router), ...series.map((s) => logs(s.series))])).flat();
      const out: Activity[] = [];
      for (const l of all) {
        const d = l.decoded;
        if (!d) continue;
        const p = Object.fromEntries(d.parameters.map((x) => [x.name, x.value]));
        const ev = d.method_call.split("(")[0];
        const at = Date.parse(l.block_timestamp) / 1000;
        const base = {key: `${l.transaction_hash}-${l.index}`, at, tx: l.transaction_hash};
        const s = bySeries.get(l.address.hash.toLowerCase());
        const by = (p.by ?? "").toLowerCase();
        const scales = hooks.has(by);
        if (ev === "Minted" && s) {
          out.push({...base, who: by, kind: scales ? "scales" : "split",
            text: scales ? `The Scales split ${qty(Number(p.amount) / 1e18, 2)} ${label(s)} to close a gap` : `${short(p.by)} split ${qty(Number(p.amount) / 1e18, 2)} ${s.underlyingSymbol} at $${Math.round(n8(s.strike))}`});
        } else if (ev === "Redeemed" && s) {
          out.push({...base, who: by, kind: scales ? "scales" : "join",
            text: scales ? `The Scales put ${qty(Number(p.amount) / 1e18, 2)} ${label(s)} pairs back together` : `${short(p.by)} put ${qty(Number(p.amount) / 1e18, 2)} ${label(s)} pairs back together`});
        } else if (ev === "Claimed" && s) {
          out.push({...base, who: by, kind: "collect", text: `${short(p.by)} collected ${p.isFloor === "true" ? "Floors" : "Upsides"} on ${label(s)}`});
        } else if (ev === "SplitAndSold") {
          const ss = bySeries.get((p.series ?? "").toLowerCase()) ?? (rows ?? []).find((r) => r.series.toLowerCase() === (p.series ?? "").toLowerCase());
          if (!ss) continue;
          out.push({...base, who: by, kind: "sell", text: `${short(p.by)} split ${qty(Number(p.amount) / 1e18, 2)} ${ss.underlyingSymbol} at $${Math.round(n8(ss.strike))} and took ${money(Number(p.quoteOut) / 1e6)} cash`});
        } else if (ev === "Swapped") {
          const tin = (p.tokenIn ?? "").toLowerCase(), tout = (p.tokenOut ?? "").toLowerCase();
          if (tin === usdg && byToken.has(tout)) {
            const {s: ss, half} = byToken.get(tout)!;
            out.push({...base, who: by, kind: "buy", text: `${short(p.by)} bought ${qty(Number(p.amountOut) / 1e18, 3)} ${half}s of ${label(ss)} for ${money(Number(p.amountIn) / 1e6)}`});
          } else if (tout === usdg && byToken.has(tin)) {
            const {s: ss, half} = byToken.get(tin)!;
            out.push({...base, who: by, kind: "sell", text: `${short(p.by)} sold ${qty(Number(p.amountIn) / 1e18, 3)} ${half}s of ${label(ss)} for ${money(Number(p.amountOut) / 1e6)}`});
          }
        }
      }
      const seen = new Set<string>();
      return out.sort((a, b) => b.at - a.at).filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true))).slice(0, 14);
    },
  });
}
