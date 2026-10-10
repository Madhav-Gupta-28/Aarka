"use client";

import {useState} from "react";
import {ADDRESSES, MARKETS} from "@/lib/contracts";
import {stocksOf, useSeries} from "@/lib/data";
import {endShort, n8, short} from "@/lib/format";
import {explorerAddr} from "@/lib/tx";
import type {Chamber} from "./terms";

/**
 * The same voyage, as a reference: every rule in the order the story tells it, with the numbers,
 * the formulas and the addresses. No animation. Each section links to its 3D chamber.
 */

const ROWS: {id: string; h: string; chamber?: Chamber; rows: [string, React.ReactNode][]}[] = [
  {id: "share", h: "Series", chamber: "coin", rows: [
    ["Unit", "One share token of the underlying (18 decimals)."],
    ["Strike K", "Fixed at creation, 8 decimals, in USD."],
    ["Expiry", "Fixed at creation. Typically 16:00 New York time on the end date."],
    ["mint(amount, to)", "Takes `amount` share tokens; gives `amount` Floor + `amount` Upside. Open status only."],
    ["redeem(amount, to)", "Burns `amount` Floor + `amount` Upside; returns `amount` share tokens. Any status. Never paused."],
  ]},
  {id: "halves", h: "Payoffs at final price P", chamber: "coin", rows: [
    ["Floor, per unit", <code key="f">min(P, K) / P  share tokens</code>],
    ["Upside, per unit", <code key="u">max(P − K, 0) / P  share tokens</code>],
    ["Identity", <code key="i">floor + upside = 1 share token, for every P</code>],
  ]},
  {id: "final", h: "Settlement", chamber: "sun", rows: [
    ["settle(roundId)", "Anyone, after expiry. Round must satisfy updatedAt ≤ expiry, with no later round at or before expiry."],
    ["Freshness", "expiry − updatedAt ≤ MAX_SETTLEMENT_AGE = 26 hours. Sequencer up; no corporate action since the round."],
    ["Late path", "After LATE_SETTLEMENT_DELAY = 7 days: round pinning and feed decimals only; any age accepted."],
    ["challengeSettlement(id)", "Anyone, within CHALLENGE_PERIOD = 1 hour. Strictly later round, still ≤ expiry. Window never extends."],
    ["Claims", "claimFloor / claimUpside(amount, to) once claimsUnlockAt passes. No deadline."],
    ["Status (lens)", "Open → Expired → Challenging → Claimable"],
  ]},
  {id: "sun", h: "Price source", chamber: "sun", rows: [
    ["Provider", "Chainlink Data Feeds. On this testnet the feeds are stand-ins carrying the real mainnet prices, copied across by script."],
    ["Updates", "On deviation, plus a 24-hour heartbeat."],
    ["Admin keys", "None can set or override a price. No proxies, no upgrades, no pause on user funds."],
  ]},
  {id: "scales", h: "The Scales (AarkaParityHook)", chamber: "scales", rows: [
    ["Hook points", "afterSwap (the deployed hooks). The audit-fix branch adds liquidity-age checks."],
    ["Invariant", <code key="p">P(floor) + P(upside) == P(share)</code>],
    ["Sum too high", "Buy share in P1, mint, sell Floor in P2 and Upside in P3."],
    ["Sum too low", "Buy Floor and Upside, redeem, sell share in P1."],
    ["Capital", "None. Runs inside the PoolManager lock with flash accounting; profit is donated to LPs."],
    ["Pools", "Fee 0.3%, tick spacing 60, all quoted in test USDG."],
  ]},
  {id: "risks", h: "Risks and limits", rows: [
    ["Upside", "Can end at 0."],
    ["Floor", "Falls with the share below K."],
    ["Slippage", "Orders bound at 0.5% from a simulation taken just before sending."],
    ["Not present", "Borrowing, margin, liquidation, admin price setting."],
  ]},
];

export function Spec({onOpen}: {onOpen: (c: Chamber) => void}) {
  const {data: rows} = useSeries();
  const stocks = stocksOf(rows);
  const [copied, setCopied] = useState("");
  const copy = (v: string) => { navigator.clipboard?.writeText(v).catch(() => {}); setCopied(v); setTimeout(() => setCopied(""), 1400); };

  const addrs: [string, string][] = [
    ["Factory", ADDRESSES.factory], ["Lens", ADDRESSES.lens], ["Router", ADDRESSES.router], ["Calendar", ADDRESSES.calendar],
    ["Hook lens", ADDRESSES.hookLens], ["Pool manager", ADDRESSES.poolManager], ["USDG (test cash)", ADDRESSES.usdg],
    ["NVDA (test share)", ADDRESSES.nvda], ["NVDA/USD feed", ADDRESSES.feed], ["TSLA (test share)", ADDRESSES.tsla], ["TSLA/USD feed", ADDRESSES.tslaFeed],
  ];
  const open = (rows ?? []).filter((r) => r.status === 0);

  return (
    <div className="spec wrap">
      <aside className="spec-toc" aria-label="Sections">
        {ROWS.map((r) => <a key={r.id} href={`#${r.id}`}>{r.h}</a>)}
        <a href="#addresses">Addresses</a>
        <a href="#live">Live series</a>
      </aside>
      <div className="spec-body">
        {ROWS.map((r) => (
          <section key={r.id} id={r.id} className="spec-sec">
            <div className="row" style={{justifyContent: "space-between", alignItems: "baseline", gap: 12}}>
              <h2 className="display">{r.h}</h2>
              {r.chamber && <button className="term-dive mono" onClick={() => onOpen(r.chamber!)}>3D DEEP DIVE ⤢</button>}
            </div>
            <dl>{r.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </section>
        ))}

        <section id="addresses" className="spec-sec">
          <h2 className="display">Addresses · Robinhood Chain testnet (46630)</h2>
          <dl>
            {addrs.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd className="row gap-12"><a href={explorerAddr(v)} target="_blank" rel="noreferrer" className="mono">{v}</a><button className="term-btn" onClick={() => copy(v)}>{copied === v ? "COPIED" : "COPY"}</button></dd></div>
            ))}
          </dl>
        </section>

        <section id="live" className="spec-sec">
          <h2 className="display">Live series</h2>
          <div className="term-scroll">
            <table className="term-table">
              <thead><tr><th><span>SERIES</span></th><th><span>STOCK</span></th><th className="r"><span>K</span></th><th><span>EXPIRY</span></th><th><span>HOOK</span></th></tr></thead>
              <tbody>
                {open.map((s) => {
                  const h = MARKETS[s.series.toLowerCase()];
                  return (
                    <tr key={s.series}>
                      <td><a href={explorerAddr(s.series)} target="_blank" rel="noreferrer">{short(s.series)}</a></td>
                      <td>{s.underlyingSymbol}</td>
                      <td className="r">{n8(s.strike).toFixed(2)}</td>
                      <td>{endShort(s.expiry)}</td>
                      <td>{h ? <a href={explorerAddr(h)} target="_blank" rel="noreferrer">{short(h)}</a> : <span className="muted">none</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted">{stocks.map((s) => `${s.symbol}/USD ${s.fresh ? "live" : "delayed"}`).join(" · ")}</p>
        </section>
      </div>
    </div>
  );
}
