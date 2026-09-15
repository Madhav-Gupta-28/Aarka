"use client";

import {useEffect, useState} from "react";
import {useAccount} from "wagmi";
import {STATUS_LABEL} from "@/lib/contracts";
import {readPositions, type Position} from "@/lib/lens";
import {units, usd} from "@/lib/format";
import type {SeriesView} from "./SeriesCard";

/** Everything the connected wallet holds, read a page of series at a time. */
export function Positions({series}: {series: SeriesView[]}) {
  const {address, isConnected} = useAccount();
  const [rows, setRows] = useState<Position[]>([]);

  useEffect(() => {
    if (!address) { setRows([]); return; }
    let live = true;
    const load = () => readPositions(address).then((r) => { if (live) setRows(r); }).catch(() => {});
    load();
    const t = setInterval(load, 12_000);
    return () => { live = false; clearInterval(t); };
  }, [address]);

  if (!isConnected) return null;
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
          const s = series.find((x) => x.series.toLowerCase() === p.series.toLowerCase());
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
