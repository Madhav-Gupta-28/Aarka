"use client";

import {protocolStats} from "@/lib/marketData";
import {units} from "@/lib/format";
import type {SeriesView} from "@/lib/types";

/** What the deployment adds up to, straight from the series list already on screen. */
export function StatStrip({series}: {series: SeriesView[]}) {
  const s = protocolStats(series);
  return (
    <div className="stats">
      <div className="stat">
        <span>Open series</span>
        <b>{s.live}</b>
        <em>of {s.total} created</em>
      </div>
      <div className="stat">
        <span>Tradable markets</span>
        <b>{s.tradable}</b>
        <em>a pool for each half</em>
      </div>
      <div className="stat">
        <span>Stock in the vaults</span>
        <b>{units(s.deposited, 0)}</b>
        <em>shares deposited</em>
      </div>
      <div className="stat">
        <span>Halves outstanding</span>
        <b>{units(s.outstanding, 0)}</b>
        <em>of each, always equal</em>
      </div>
    </div>
  );
}
