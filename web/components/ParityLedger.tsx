"use client";

import {cash} from "@/lib/format";
import type {Parity} from "@/lib/marketData";

/**
 * The identity, as the chain currently reports it.
 *
 * Every other number on a market page is a price someone chose. These four are an arithmetic
 * claim — floor plus upside equals the stock — and the last row is how far off it is right now.
 */
export function ParityLedger({p, title}: {p: Parity; title?: boolean}) {
  const atParity = p.gapBps < p.minDeviationBps;
  return (
    <div className="ledger">
      {title && (
        <div className="lrow" style={{borderBottom: "1px solid var(--line)"}}>
          <span>the two halves against the stock</span>
        </div>
      )}
      <div className="lrow"><span>floor pool</span><b>{cash(p.floorPrice)}</b></div>
      <div className="lrow"><span>upside pool</span><b>{cash(p.upsidePrice)}</b></div>
      <div className="lrow sum"><span>together</span><b>{cash(p.sumOfHalves)}</b></div>
      <div className="lrow"><span>stock pool</span><b>{cash(p.underlyingPrice)}</b></div>
      <div className={`lrow gap ${atParity ? "ok" : "off"}`}>
        <span>difference</span>
        <b>
          {p.gapBps.toString()} bps{" "}
          {atParity ? "· at parity" : p.halvesDear ? "· halves dear" : "· halves cheap"}
        </b>
      </div>
    </div>
  );
}
