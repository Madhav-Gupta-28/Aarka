"use client";

import {useState} from "react";
import {useAction, type Kind, type Piece} from "@/lib/actions";
import type {Balances, Quote} from "@/lib/data";
import {useRounds} from "@/lib/data";
import type {SeriesView} from "@/lib/lens";
import {marketFor} from "@/lib/contracts";
import {cleanAmount, countdown, endCode, money, qty, short} from "@/lib/format";
import {PANEL_TABS} from "./ActionPanel";
import {GearAnim} from "./Relic";
import {PayoffChart, WhatIfTrack, payoff, useWhatIf} from "./WhatIf";

const f2 = (v: number) => v.toFixed(2);
const pctS = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

/** The dense view: every number on one screen, the way a terminal would show it. */
export function TerminalSplit({s, q, bal, w}: {s: SeriesView; q: Quote; bal?: Balances; w: ReturnType<typeof useWhatIf>}) {
  const K = q.strike;
  const [tab, setTab] = useState<Kind>("split");
  const [piece, setPiece] = useState<Piece>("upside");
  const [amount, setAmount] = useState("1");
  const a = useAction({s, q, bal, kind: tab, piece, amount});
  const {data: rounds} = useRounds(s.feed);

  const step = Math.max(10, Math.round((w.max - w.min) / 12 / 10) * 10);
  const grid: number[] = [];
  for (let v = w.min + step; v < w.max; v += step) grid.push(v);
  if (!grid.includes(Math.round(K))) grid.push(Math.round(K));
  grid.sort((x, y) => x - y);
  const nearest = grid.reduce((b, v) => (Math.abs(v - w.price) < Math.abs(b - w.price) ? v : b), grid[0]);

  const stats: [string, string, string?][] = [
    ["TICKER", s.underlyingSymbol], ["LAST", f2(q.spot), "gold"], ["FEED", q.fresh ? "LIVE" : "DELAYED", q.fresh ? "up" : "down"],
    ["LINE", f2(K)], ["END", endCode(s.expiry)], ["LEFT", countdown(s.expiry).replace(" ", "")],
    ["FLOOR", f2(q.floor), "gold"], ["UPSIDE", f2(q.upside), "gold"], ["F+U", f2(q.floor + q.upside), "gold"],
    ["SRC", q.source === "market" ? "POOLS" : "MODEL", q.source === "market" ? "up" : "muted"],
  ];

  const lines = [
    ...a.give.map((g) => ({k: `GIVE ${g.k.toUpperCase()}`, v: g.v, c: ""})),
    ...a.get.map((g) => ({k: `GET ${g.k.toUpperCase()}`, v: g.v, c: "gold"})),
    {k: "NETWORK FEE", v: "TESTNET ETH", c: ""},
  ];

  return (
    <section className="term-wrap term">
      <div className="term-stats">
        {stats.map(([k, v, c]) => <div key={k}><span>{k}</span><b className={c}>{v}</b></div>)}
      </div>
      <div className="term-grid">
        <div>
          <div className="term-box term-scroll">
            <div className="bar"><span>SCENARIOS · VALUE PER PIECE AT END</span><span className="muted">WHAT-IF <span className="gold">{money(w.price)}</span></span></div>
            <table className="term-table" style={{border: 0}}>
              <thead><tr>
                {["END PRICE", "FLOOR $", "Δ FLOOR", "UPSIDE $", "Δ UPSIDE", "SUM $"].map((h, i) => <th key={h} className={i ? "r" : ""}><span>{h}</span></th>)}
              </tr></thead>
              <tbody>
                {grid.map((e) => {
                  const {floor, upside} = payoff(e, K);
                  return (
                    <tr key={e} className={e === nearest ? "on" : ""} style={{cursor: "pointer"}} onClick={() => w.setPrice(e)}>
                      <td>{f2(e)}{Math.round(K) === e ? "  LINE" : ""}</td>
                      <td className="r">{f2(floor)}</td>
                      <td className={`r ${floor >= q.floor ? "up" : "down"}`}>{q.floor ? pctS(((floor - q.floor) / q.floor) * 100) : "—"}</td>
                      <td className="r">{f2(upside)}</td>
                      <td className={`r ${upside >= q.upside ? "up" : "down"}`}>{q.upside ? pctS(((upside - q.upside) / q.upside) * 100) : "—"}</td>
                      <td className="r">{f2(e)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="term-box" style={{padding: 12}}>
            <PayoffChart terminal strike={K} price={w.price} min={w.min} max={w.max} spot={q.spot} label="" />
            <div style={{margin: "0 13px 0 7%"}}><WhatIfTrack thin strike={K} price={w.price} setPrice={w.setPrice} min={w.min} max={w.max} name={s.underlyingSymbol} /></div>
          </div>
        </div>
        <div>
          <div className="term-box">
            <div className="term-tabs">
              {PANEL_TABS.map((t) => <button key={t.kind} aria-pressed={tab === t.kind} onClick={() => { setTab(t.kind); setAmount(t.kind === "buy" ? "100" : "1"); a.reset(); }}>{t.key}</button>)}
            </div>
            <div style={{padding: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 14, lineHeight: 1.4}}>
              {(tab === "buy" || tab === "sell") && (
                <div className="term-tabs" style={{border: "1px solid var(--line)"}}>
                  <button aria-pressed={piece === "floor"} onClick={() => setPiece("floor")}>FLOOR</button>
                  <button aria-pressed={piece === "upside"} onClick={() => setPiece("upside")}>UPSIDE</button>
                </div>
              )}
              <div className="row muted" style={{justifyContent: "space-between"}}>
                <span>{tab === "buy" ? "CASH · USD" : tab === "rejoin" ? "QTY · PAIRS" : tab === "sell" ? `QTY · ${piece.toUpperCase()}` : "QTY · SHARES"}</span>
                <span>{a.connected ? (tab === "buy" ? `CASH ${money(a.max)}` : `HOLD ${qty(a.max)}`) : "NOT CONNECTED"}</span>
              </div>
              <div className="row gap-8">
                <input aria-label="Quantity" inputMode="decimal" className="term-input" value={amount} style={a.err ? {borderColor: "var(--down)"} : undefined}
                       onChange={(e) => setAmount(cleanAmount(e.target.value, tab === "buy" ? 2 : 6))} />
                {a.connected && <button className="term-btn" style={{height: 44}} onClick={() => setAmount(a.useMax())}>MAX</button>}
              </div>
              {a.err && <span className="down" style={{fontSize: 13}}>{a.err}</span>}
              {lines.map((l) => <div key={l.k} className="term-line"><span className="muted">{l.k}</span><span className={l.c}>{l.v}</span></div>)}
              <button className="btn btn-primary" style={{height: 48, borderRadius: 6, fontFamily: "var(--f-num)", fontStretch: "87.5%", fontSize: 14, letterSpacing: ".06em"}} disabled={a.cta.disabled} onClick={() => a.cta.onClick()}>
                {a.cta.spin && <GearAnim size={24} />}{a.cta.label.toUpperCase()}
              </button>
              <span className="muted" style={{fontSize: 12}}>{a.txError ?? a.steps}</span>
            </div>
          </div>
          <div className="term-box" style={{borderColor: "var(--lapis-line)"}}>
            <div className="bar" style={{borderColor: "var(--lapis-line)", background: "var(--lapis-bg)"}}><span className="lapis">THE SUN · {s.underlyingSymbol}/USD</span><span className={q.fresh ? "up" : "down"}>● {q.fresh ? "LIVE" : "DELAYED"}</span></div>
            <div style={{padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13, lineHeight: 1.3, color: "var(--text-2)"}}>
              {(rounds ?? []).map((r) => (
                <div key={r.id.toString()} style={{display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 8}}>
                  <span className="muted">{new Date(r.at * 1000).toLocaleString("en-US", {month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false})}</span>
                  <span className="gold" style={{textAlign: "right"}}>{f2(r.price)}</span>
                  <span className="muted" style={{textAlign: "right"}}>#{(r.id & 0xffffffffn).toString()}</span>
                </div>
              ))}
              {!rounds && <span className="muted">READING ROUNDS…</span>}
            </div>
          </div>
          <div className="term-kv">
            <span>FLOOR TOKEN</span><span>{s.floorSymbol}</span>
            <span>UPSIDE TOKEN</span><span>{s.upsideSymbol}</span>
            <span>CONTRACT</span><span>{short(s.series)}</span>
            <span>PAYOFF</span><span>F=min(P,{Math.round(K)}) · U=max(P−{Math.round(K)},0)</span>
            <span>SCALES</span><span className={marketFor(s.series) ? "up" : "muted"}>{marketFor(s.series) ? `HOOK ${short(marketFor(s.series))}` : "NO POOLS"}</span>
            <span>SLIPPAGE</span><span>0.50% max</span>
          </div>
        </div>
      </div>
    </section>
  );
}
