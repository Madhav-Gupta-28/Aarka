"use client";

import {useAccount, useReadContract} from "wagmi";
import {ADDRESSES, LENS_ABI, STATUS_LABEL} from "@/lib/contracts";
import {units, usd} from "@/lib/format";
import type {SeriesView} from "./SeriesCard";

type Position = {
  series: `0x${string}`;
  underlyingBalance: bigint; underlyingAllowance: bigint;
  floorBalance: bigint; upsideBalance: bigint;
  redeemable: bigint; floorClaimable: bigint; upsideClaimable: bigint;
};

/** Everything the connected wallet holds, across every series, in one call. */
export function Positions({series}: {series: SeriesView[]}) {
  const {address, isConnected} = useAccount();
  const {data} = useReadContract({
    address: ADDRESSES.lens as `0x${string}`, abi: LENS_ABI, functionName: "positionsOf",
    args: address ? [address] : undefined,
    query: {enabled: !!address, refetchInterval: 12_000},
  });

  if (!isConnected) return null;
  const rows = (data as unknown as Position[] | undefined) ?? [];
  const held = rows.filter((p) => p.floorBalance > 0n || p.upsideBalance > 0n);
  if (held.length === 0) return null;

  return (
    <>
      <div className="sectionHead" style={{marginTop: 44}}>
        <h2>What you hold</h2>
        <span>{held.length} of {rows.length} series</span>
      </div>

      <div className="posTable">
        {held.map((p) => {
          const s = series.find((x) => x.series === p.series);
          if (!s) return null;
          const settled = s.settled;
          return (
            <div className="posRow" key={p.series}>
              <div className="posHead">
                <b>{s.underlyingSymbol} {usd(s.strike, 0)}</b>
                <span className="pill">{STATUS_LABEL[s.status]}</span>
              </div>
              <div className="posCells">
                <div>
                  <span>floor</span>
                  <b>{units(p.floorBalance)}</b>
                  {settled && <em>→ {units(p.floorClaimable)} {s.underlyingSymbol}</em>}
                </div>
                <div>
                  <span>upside</span>
                  <b>{units(p.upsideBalance)}</b>
                  {settled && <em>→ {units(p.upsideClaimable)} {s.underlyingSymbol}</em>}
                </div>
                <div>
                  <span>recombinable</span>
                  <b>{units(p.redeemable)}</b>
                  <em>{p.redeemable > 0n ? "pairs, any time" : "need one of each"}</em>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
