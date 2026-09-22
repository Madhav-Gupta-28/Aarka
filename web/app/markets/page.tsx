"use client";

import {useState} from "react";
import {useData} from "@/components/DataProvider";
import {Chain} from "@/components/Chain";
import {StatStrip} from "@/components/StatStrip";

type Filter = "live" | "settling" | "settled" | "all";

const MATCHES: Record<Filter, (status: number) => boolean> = {
  live: (s) => s === 0,
  settling: (s) => s === 1 || s === 2,
  settled: (s) => s === 3,
  all: () => true,
};

const LABELS: {id: Filter; label: string}[] = [
  {id: "live", label: "Live"},
  {id: "settling", label: "Settling"},
  {id: "settled", label: "Settled"},
  {id: "all", label: "All"},
];

export default function Markets() {
  const {series, error} = useData();
  const [filter, setFilter] = useState<Filter>("live");
  const [ticker, setTicker] = useState<string>("all");

  const tickers = [...new Set(series?.map((s) => s.underlyingSymbol) ?? [])].sort();
  const rows = (series ?? [])
    .filter((s) => MATCHES[filter](s.status))
    .filter((s) => ticker === "all" || s.underlyingSymbol === ticker);

  return (
    <>
      <div className="pageHead">
        <div>
          <span className="eyebrow">Markets</span>
          <h1>Every strike, every expiry</h1>
          <p>
            One row is one series. The floor pays everything up to its strike, the upside pays
            everything above it, and the two always sum to one whole share — which is the number
            the parity column is checking.
          </p>
        </div>
      </div>

      {series && <StatStrip series={series} />}

      <div className="filters" style={{marginTop: 22}}>
        {LABELS.map((f) => (
          <button key={f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <span style={{width: 12}} />
        <button className={ticker === "all" ? "on" : ""} onClick={() => setTicker("all")}>
          All tickers
        </button>
        {tickers.map((t) => (
          <button key={t} className={ticker === t ? "on" : ""} onClick={() => setTicker(t)}>
            {t}
          </button>
        ))}
      </div>

      {error && <div className="err">Could not reach Robinhood Chain testnet. {error}</div>}
      {!series && !error && <div className="loading">Reading the chain…</div>}

      {series && rows.length === 0 && (
        <div className="empty">
          <b>Nothing here yet</b>
          <p>No series match that filter. Try another status, or look at every ticker.</p>
        </div>
      )}

      {rows.length > 0 && <Chain rows={rows} />}
    </>
  );
}
