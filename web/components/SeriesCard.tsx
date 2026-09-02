"use client";

import {STATUS_LABEL} from "@/lib/contracts";
import {usd, units, pct, expiryLabel, countdown} from "@/lib/format";

export type SeriesView = {
  series: `0x${string}`;
  underlying: `0x${string}`;
  floorToken: `0x${string}`;
  upsideToken: `0x${string}`;
  status: number;
  underlyingSymbol: string;
  strike: bigint;
  expiry: bigint;
  floorSymbol: string;
  upsideSymbol: string;
  spotUpdatedAt: bigint;
  oraclePaused: boolean;
  claimsUnlockAt: bigint;
  halfSupply: bigint;
  feed: `0x${string}`;
  spotPrice: bigint;
  priceValid: boolean;
  settled: boolean;
  settlementPrice: bigint;
  floorPayoutPerUnit: bigint;
  upsidePayoutPerUnit: bigint;
  totalDeposited: bigint;
};

export function SeriesCard({s, onSelect}: {s: SeriesView; onSelect?: () => void}) {
  const open = s.status === 0;
  const claimable = s.status === 3;

  return (
    <div className="card" onClick={onSelect} role={onSelect ? "button" : undefined}>
      <div className="cardTop">
        <div className="ticker">
          {s.underlyingSymbol} <span style={{color: "var(--muted)"}}>{usd(s.strike, 0)}</span>
        </div>
        <div className={`pill ${open ? "open" : claimable ? "claimable" : ""}`}>
          {STATUS_LABEL[s.status]}
        </div>
      </div>

      <div className="rows">
        <div className="row">
          <span>Expiry</span>
          <b>{expiryLabel(s.expiry)}{open && ` · ${countdown(s.expiry)}`}</b>
        </div>
        <div className="row">
          <span>{s.settled ? "Settled at" : "Spot"}</span>
          <b>{s.settled ? usd(s.settlementPrice) : s.priceValid ? usd(s.spotPrice) : "—"}</b>
        </div>
        {s.settled ? (
          <div className="row">
            <span>Split</span>
            <b>{pct(s.floorPayoutPerUnit)} / {pct(s.upsidePayoutPerUnit)}</b>
          </div>
        ) : (
          <div className="row">
            <span>Deposited</span>
            <b>{units(s.totalDeposited)} {s.underlyingSymbol}</b>
          </div>
        )}
      </div>

      <div className="halves">
        <div className="half f">{s.floorSymbol}</div>
        <div className="half u">{s.upsideSymbol}</div>
      </div>
    </div>
  );
}
