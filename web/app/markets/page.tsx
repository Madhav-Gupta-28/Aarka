"use client";

import Link from "next/link";
import {useEffect, useMemo, useState} from "react";
import {Shell} from "@/components/Chrome";
import {Relic, Reveal} from "@/components/Relic";
import {SeriesStamp, astroFrac} from "@/components/SplitBits";
import {quoteFor, stocksOf, useParityAll, useSeries, type Quote} from "@/lib/data";
import type {SeriesView} from "@/lib/lens";
import {endCode, endShort, money, n8, nowSec, plural, stockMono, stockName, lineLabel} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {spot, usePrefs} from "@/lib/ui";

type Row = {s: SeriesView; q: Quote; days: number; above: boolean};
type SortKey = "t" | "last" | "line" | "above" | "end" | "floor" | "up" | "days";

const daysLeft = (s: SeriesView) => Math.max(0, Math.ceil((Number(s.expiry) - nowSec()) / 86400));

export default function Markets() {
  const {data: series, isLoading, error} = useSeries();
  const {data: parity} = useParityAll(series);
  const {view} = usePrefs();
  const [stock, setStock] = useState("all");
  const [date, setDate] = useState("all");
  const [pos, setPos] = useState<"all" | "above" | "below">("all");
  const [sort, setSort] = useState<{k: SortKey; d: 1 | -1}>({k: "days", d: 1});

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("stock");
    if (p) setStock(p);
  }, []);

  const rows: Row[] = useMemo(() => (series ?? []).map((s) => {
    const q = quoteFor(s, parity);
    return {s, q, days: daysLeft(s), above: q.strike > q.spot};
  }).sort((a, b) => (a.s.status === 0 ? 0 : 1) - (b.s.status === 0 ? 0 : 1) || Number(a.s.expiry - b.s.expiry)), [series, parity]);

  const match = (r: Row, o: {stock?: string; date?: string; pos?: string} = {}) => {
    const st = o.stock ?? stock, dt = o.date ?? date, ps = o.pos ?? pos;
    return (st === "all" || r.s.underlyingSymbol === st) && (dt === "all" || endCode(r.s.expiry) === dt) && (ps === "all" || (ps === "above" ? r.above : !r.above));
  };
  const list = rows.filter((r) => match(r));
  const stocks = stocksOf(series);
  const ends = [...new Map(rows.map((r) => [endCode(r.s.expiry), r])).values()].sort((a, b) => Number(a.s.expiry - b.s.expiry));
  const anyFilter = stock !== "all" || date !== "all" || pos !== "all";

  const sorted = [...list].sort((a, b) => {
    const v = (r: Row): number | string => ({t: r.s.underlyingSymbol, last: r.q.spot, line: r.q.strike, above: r.above ? 1 : 0, end: Number(r.s.expiry), floor: r.q.floor, up: r.q.upside, days: r.days})[sort.k];
    const x = v(a), y = v(b);
    return (x > y ? 1 : x < y ? -1 : 0) * sort.d;
  });

  return (
    <Shell>
      <section className="gridlines" style={{paddingBlock: "clamp(40px, 5vw, 72px) 48px"}}>
        <div className="wrap head12 with-note">
          <div className="stack gap-10" style={{gridColumn: "1 / span 3"}}>
            <span className="kicker">F1 · MARKETS</span>
            <span className="label" style={{fontSize: 13, lineHeight: 1.5}}>
              {series ? <>{rows.length} {plural(rows.length, "SPLIT")} · {stocks.length} {plural(stocks.length, "STOCK")}<br />{ends.length} END {plural(ends.length, "DATE")}</> : "READING THE CHAIN…"}
            </span>
          </div>
          <h1 className="display h-xl rise" style={{fontSize: "clamp(56px, 8.9vw, 128px)"}}>Choose a <span className="px-em">split</span></h1>
          <p className="note" style={{fontSize: 17, color: "var(--text-2)"}}>Each split cuts one share into a Floor and an Upside around a line, until an end date. Pick the stock, line and date that fit you.</p>
        </div>
      </section>

      <section aria-label="Upcoming end dates" className="wrap" style={{paddingBottom: 40}}>
        <div className="dates" style={{"--n": ends.length + 1} as React.CSSProperties}>
          <div><span className="label">END DATES</span><span className="small">Tap a dial to see splits that end that day.</span></div>
          <button className="date-btn" aria-pressed={date === "all"} onClick={() => setDate("all")}>
            <Relic name="coinFull" size={64} />
            <span className="stack gap-6" style={{gap: 6}}><span className="num dl" style={{fontSize: 22}}>All dates</span><span className="small">{rows.length} {plural(rows.length, "split")}</span></span>
          </button>
          {ends.map((r) => {
            const code = endCode(r.s.expiry), n = rows.filter((x) => endCode(x.s.expiry) === code).length;
            return (
              <button key={code} className="date-btn" aria-pressed={date === code} onClick={() => setDate(code)}>
                <Relic src={RELIC.astro(astroFrac(r.s.expiry))} size={64} />
                <span className="stack" style={{gap: 6}}>
                  <span className="num dl" style={{fontSize: 22}}>{endShort(r.s.expiry)}</span>
                  <span className="small">{n} {plural(n, "split")}</span>
                  <span className="label">{r.days > 0 ? `${r.days} ${plural(r.days, "DAY")}` : "ENDED"}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="wrap stack gap-12" style={{paddingBottom: 32, gap: 14}}>
        <div className="filter-row">
          <span className="label">STOCK</span>
          <div className="wrap-row gap-8">
            {[{k: "all", l: "All stocks"}, ...stocks.map((s) => ({k: s.symbol, l: stockName(s.symbol)}))].map((c) => (
              <button key={c.k} className="chip" aria-pressed={stock === c.k} onClick={() => setStock(c.k)}>
                {c.l}<span className="sub">{rows.filter((r) => match(r, {stock: c.k})).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <span className="label">THE LINE</span>
          <div className="wrap-row gap-8">
            {([["all", "Any line"], ["above", "Line above today’s price"], ["below", "Line below today’s price"]] as const).map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={pos === k} onClick={() => setPos(k)}>{l}</button>
            ))}
          </div>
          <span className="mono ml-auto" style={{fontSize: 14, color: "var(--text-2)"}}>{list.length} {plural(list.length, "SPLIT")}</span>
          {anyFilter && <button className="btn btn-quiet btn-sm" onClick={() => { setStock("all"); setDate("all"); setPos("all"); }}>Clear filters</button>}
        </div>
      </section>

      {error && <div className="wrap" style={{paddingBottom: 64}}><p className="note-line risk">Could not reach the network. {error.message.split("\n")[0]} Your funds are fine; this page will retry.</p></div>}
      {isLoading && <div className="wrap split-cards" style={{paddingBottom: 96}}>{[0, 1, 2].map((i) => <div key={i} className="skel" style={{height: 300}} />)}</div>}

      {series && list.length === 0 && (
        <section className="wrap" style={{paddingBlock: "24px 128px"}}>
          <div className="empty-box dither">
            <Relic name="fragAstro" size={192} />
            <div className="stack gap-16" style={{alignItems: "flex-start"}}>
              <span className="label">NOTHING HERE</span>
              <h2 className="display h-sub">No splits match.</h2>
              <p className="lead" style={{fontSize: 18}}>Try another end date. {stock !== "all" && date !== "all" ? `${stockName(stock)} has no split ending that day.` : "Or widen the line filter."}</p>
              <button className="btn btn-secondary" onClick={() => { setStock("all"); setDate("all"); setPos("all"); }}>Clear filters</button>
            </div>
          </div>
        </section>
      )}

      {list.length > 0 && view === "simple" && (
        <section className="wrap stack" style={{paddingBlock: "16px 112px", gap: 56}}>
          {stocks.filter((st) => list.some((r) => r.s.underlyingSymbol === st.symbol)).map((st) => (
            <div key={st.symbol} className="stack gap-20">
              <div className="group-head">
                <div aria-hidden className="monogram sm">{stockMono(st.symbol)}</div>
                <h2 className="display" style={{fontSize: "clamp(32px, 3.3vw, 48px)", lineHeight: 1}}>{stockName(st.symbol)}</h2>
                <span className="label" style={{fontSize: 13}}>{st.symbol}</span>
                <span className="num gold ml-auto" style={{fontSize: 28}}>{st.spot ? money(st.spot) : "—"}</span>
                <span className={`mono ${st.fresh ? "up" : "down"}`} style={{fontSize: 13}}>● {st.fresh ? "LIVE" : "DELAYED"}</span>
              </div>
              <div className="split-cards">
                {list.filter((r) => r.s.underlyingSymbol === st.symbol).map((r, i) => <SplitCard key={r.s.series} r={r} delay={i * 80} />)}
              </div>
            </div>
          ))}
        </section>
      )}

      {list.length > 0 && view === "terminal" && (
        <section style={{padding: "8px 24px 64px"}} className="term-scroll">
          <table className="term-table">
            <thead><tr>
              {([["t", "STOCK", ""], ["last", "LAST", "r"], ["line", "LINE", "r"], ["above", "VS TODAY", ""], ["end", "ENDS", ""], ["floor", "FLOOR $", "r"], ["up", "UPSIDE $", "r"], ["days", "DAYS LEFT", "r"]] as [SortKey, string, string][]).map(([k, l, c]) => (
                <th key={k} className={c} aria-sort={sort.k === k ? (sort.d > 0 ? "ascending" : "descending") : "none"}>
                  <button onClick={() => setSort({k, d: sort.k === k ? (sort.d === 1 ? -1 : 1) : 1})}>{l} {sort.k === k ? (sort.d > 0 ? "▲" : "▼") : ""}</button>
                </th>
              ))}
              <th><span>SRC</span></th><th style={{width: 90}} />
            </tr></thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.s.series}>
                  <td style={{fontWeight: 600}}>{r.s.underlyingSymbol}</td>
                  <td className="r">{r.q.spot.toFixed(2)}</td>
                  <td className="r">{r.q.strike.toFixed(2)}</td>
                  <td className={r.above ? "" : "muted"}>{r.above ? "ABOVE ▲" : "BELOW ▼"}</td>
                  <td>{endCode(r.s.expiry)}</td>
                  <td className="r gold">{r.q.floor.toFixed(2)}</td>
                  <td className="r gold">{r.q.upside.toFixed(2)}</td>
                  <td className="r">{r.s.status === 0 ? r.days : "ENDED"}</td>
                  <td className={r.q.source === "market" ? "up" : "muted"}>{r.q.source === "market" ? "POOLS" : "MODEL"}</td>
                  <td className="r"><Link className="term-btn" href={`/split/${r.s.series}`}>VIEW</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row mono muted" style={{justifyContent: "space-between", padding: "10px 4px", fontSize: 12}}>
            <span>PRICES · THE SUN · POOLS WHERE THEY TRADE, MODEL WHERE THEY DON’T</span><span>CLICK A HEADER TO SORT</span>
          </div>
        </section>
      )}
    </Shell>
  );
}

function SplitCard({r, delay}: {r: Row; delay: number}) {
  const {s, q} = r;
  const name = stockName(s.underlyingSymbol);
  const lt = `$${lineLabel(q.strike)}`;
  const pct = ((q.strike - q.spot) / (q.spot || 1)) * 100;
  const open = s.status === 0;
  const note = !open ? "This split has ended. Put pairs back together, or collect once the final price is set."
    : r.above ? `The Upside has value only if ${name} ends above ${lt}, ${pct.toFixed(1)}% above today.`
      : `${name} is already ${money(q.spot - q.strike)} above the line. If it ended today, the Upside would pay that.`;
  return (
    <Reveal delay={delay}>
      <Link href={open ? `/split/${s.series}` : `/split/${s.series}/final`} className="card spot lift split-card" {...spot} style={{height: "100%"}}>
        <div className="row gap-14" style={{alignItems: "flex-start", gap: 14}}>
          <div className="stack" style={{gap: 8, minWidth: 0}}>
            <span className="label">{!open ? "ENDED" : r.above ? "LINE ABOVE TODAY ▲" : "LINE BELOW TODAY ▼"}</span>
            <strong className="display nowrap" style={{fontSize: 34, lineHeight: 1}}>{lt} line</strong>
            <span className="mono nowrap" style={{fontSize: 13, color: "var(--text-2)"}}>ENDS {endShort(s.expiry).toUpperCase()}</span>
          </div>
          <div className="ml-auto stack" style={{alignItems: "center", gap: 4}}>
            {open ? <><Relic src={RELIC.astro(astroFrac(s.expiry))} size={48} /><span className="mono" style={{fontSize: 12}}>{r.days}d</span></> : <SeriesStamp s={s} />}
          </div>
        </div>
        {open ? (
          <div className="halves2">
            <div><span className="row gap-8 mono" style={{fontSize: 12, letterSpacing: ".08em"}}><Relic name="coinFloor" size={16} />FLOOR</span><span className="num gold" style={{fontSize: 26, lineHeight: 1}}>{money(q.floor)}</span></div>
            <div><span className="row gap-8 mono" style={{fontSize: 12, letterSpacing: ".08em"}}><Relic name="coinUp" size={16} />UPSIDE</span><span className="num gold" style={{fontSize: 26, lineHeight: 1}}>{money(q.upside)}</span></div>
          </div>
        ) : (
          <div className="halves2" style={{gridTemplateColumns: "1fr"}}>
            <div><span className="row gap-8 mono" style={{fontSize: 12, letterSpacing: ".08em"}}><Relic name="stele" size={16} />FINAL PRICE · THE SUN</span>
              <span className="num gold" style={{fontSize: 26, lineHeight: 1}}>{s.settled ? money(n8(s.settlementPrice)) : "Being set"}</span></div>
          </div>
        )}
        <p className="small">{note}</p>
        <div className="row" style={{justifyContent: "space-between", marginTop: "auto"}}>
          <span className="mono" style={{fontSize: 12, color: q.source === "market" ? "var(--up)" : "var(--text-3)"}}>{!open ? (s.settled ? "READY TO COLLECT" : "WAITING FOR THE SUN") : q.source === "market" ? "● PRICED BY ITS POOLS" : "○ ESTIMATE · NO POOLS YET"}</span>
          <span className="btn btn-secondary btn-sm">View</span>
        </div>
      </Link>
    </Reveal>
  );
}
