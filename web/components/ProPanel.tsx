"use client";

import {useState} from "react";
import {marketFor} from "@/lib/contracts";
import {quoteFor, useBalances, useParityAll, useSeries} from "@/lib/data";
import {countdown, endCode, nowSec} from "@/lib/format";
import {TerminalSplit} from "./TerminalSplit";
import {useWhatIf} from "./WhatIf";

/**
 * The same section, for people who want every number. Every open split in one table, and the full
 * terminal ticket for whichever row is selected: split, buy, sell, put back together, the scenario
 * grid, the payoff and The Sun's last rounds.
 */
export function ProPanel() {
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const list = (rows ?? []).slice().sort((a, b) => (a.status - b.status) || Number(a.expiry - b.expiry) || Number(a.strike - b.strike));
  const [sel, setSel] = useState<string | null>(null);
  const s = list.find((r) => r.series === sel) ?? list.find((r) => r.status === 0 && marketFor(r.series)) ?? list[0];
  const q = s ? quoteFor(s, parity) : undefined;
  const {data: bal} = useBalances(s);
  const w = useWhatIf(q?.strike ?? 100, q?.spot ?? 0);

  return (
    <section id="app" className="section-tight rule-top" aria-label="Pro view" style={{background: "var(--bg-strip)"}}>
      <div style={{padding: "0 24px"}} className="stack gap-12">
        <div className="row" style={{justifyContent: "space-between", flexWrap: "wrap", gap: 12}}>
          <span className="kicker">PRO · EVERY SPLIT, EVERY NUMBER</span>
          <span className="mono muted" style={{fontSize: 12}}>CLICK A ROW TO LOAD IT BELOW · POOLS WHERE THEY TRADE, MODEL WHERE THEY DON’T</span>
        </div>
        <div className="term-scroll">
          <table className="term-table">
            <thead><tr>{["SPLIT", "LAST", "LINE", "ENDS", "LEFT", "FLOOR $", "UPSIDE $", "F+U", "SRC", "STATE"].map((h, i) => <th key={h} className={i && i < 8 ? "r" : ""}><span>{h}</span></th>)}</tr></thead>
            <tbody>
              {list.map((r) => {
                const rq = quoteFor(r, parity);
                return (
                  <tr key={r.series} className={s?.series === r.series ? "on" : ""} style={{cursor: "pointer"}} onClick={() => setSel(r.series)}>
                    <td style={{fontWeight: 600}}>{r.underlyingSymbol}-{Math.round(rq.strike)}-{endCode(r.expiry)}</td>
                    <td className="r">{rq.spot.toFixed(2)}</td>
                    <td className="r">{rq.strike.toFixed(2)}</td>
                    <td className="r">{endCode(r.expiry)}</td>
                    <td className="r">{r.status === 0 ? countdown(r.expiry) : "—"}</td>
                    <td className="r gold">{r.status === 0 ? rq.floor.toFixed(2) : "—"}</td>
                    <td className="r gold">{r.status === 0 ? rq.upside.toFixed(2) : "—"}</td>
                    <td className="r">{r.status === 0 ? (rq.floor + rq.upside).toFixed(2) : "—"}</td>
                    <td className={rq.source === "market" ? "up" : "muted"}>{rq.source === "market" ? "POOLS" : "MODEL"}</td>
                    <td className={r.status === 0 ? "up" : r.status === 3 ? "gold" : "muted"}>{["OPEN", "ENDED", "SETTLING", "CLAIMABLE"][r.status]}{r.status === 0 && Number(r.expiry) - nowSec() < 86400 ? " · <1D" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {s && q && <TerminalSplit key={s.series} s={s} q={q} bal={bal} w={w} />}
    </section>
  );
}
