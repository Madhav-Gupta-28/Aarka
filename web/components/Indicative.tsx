"use client";

import {useState} from "react";
import {reference} from "@/lib/pricing";
import type {SeriesView} from "./SeriesCard";

/**
 * A reference price for the two halves. Explicitly a model — nothing on-chain reads it, and the
 * protocol has no opinion on where the split should fall.
 */
export function Indicative({s}: {s: SeriesView}) {
  const [vol, setVol] = useState(40);
  if (!s.priceValid || s.settled) return null;

  const spot = Number(s.spotPrice) / 1e8;
  const strike = Number(s.strike) / 1e8;
  const secs = Number(s.expiry) - Math.floor(Date.now() / 1000);
  const r = reference(spot, strike, secs, vol / 100);
  const days = Math.max(0, secs / 86400);

  return (
    <div className="indicative">
      <div className="indHead">
        <b>Reference split</b>
        <span className="tagModel">model, not a price</span>
      </div>

      <div className="indBars">
        <div className="bar">
          <div className="fill floorFill" style={{width: `${(1 - r.upsideShare) * 100}%`}} />
          <div className="fill upsideFill" style={{width: `${r.upsideShare * 100}%`}} />
        </div>
        <div className="indLegend">
          <span><i className="swFloor" /> floor ${r.floor.toFixed(2)}</span>
          <span><i className="swUpside" /> upside ${r.upside.toFixed(2)}</span>
        </div>
      </div>

      <label className="volRow">
        <span>implied volatility</span>
        <input type="range" min={10} max={120} value={vol}
               onChange={(e) => setVol(Number(e.target.value))} />
        <b>{vol}%</b>
      </label>

      <p className="hint">
        Black-Scholes on {days.toFixed(1)} days at {vol}% vol. The vault only enforces that the two
        halves sum to one share — where the line between them falls is a market view on volatility,
        and this is just a starting point for whoever mints first.
      </p>
    </div>
  );
}
