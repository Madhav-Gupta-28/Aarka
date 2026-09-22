"use client";

import Link from "next/link";
import {useParams} from "next/navigation";
import {useData, useParity} from "@/components/DataProvider";
import {findSeries} from "@/lib/lens";
import {marketFor, STATUS_LABEL} from "@/lib/contracts";
import {explorer} from "@/lib/chain";
import {usd, units, pct, expiryLabel, countdown, cash, shortAddr, timeAgo} from "@/lib/format";
import {PayoffChart} from "@/components/PayoffChart";
import {Indicative} from "@/components/Indicative";
import {Trade} from "@/components/Trade";
import {Split} from "@/components/Split";
import {Claim} from "@/components/Claim";
import {Settle} from "@/components/Settle";
import {ParityLedger} from "@/components/ParityLedger";

/** One series: what it pays, what its halves cost, and everything you can do to it. */
export default function Market() {
  const params = useParams<{series: string}>();
  const {series, refresh} = useData();
  const s = findSeries(series, params.series);
  const p = useParity(s?.series);
  const hook = s ? marketFor(s.series) : undefined;

  if (!series) return <div className="loading">Reading the chain…</div>;
  if (!s) {
    return (
      <div className="empty">
        <b>No such series</b>
        <p>Nothing at that address on this factory. It may belong to an earlier deployment.</p>
        <Link className="btn" href="/markets">Back to markets</Link>
      </div>
    );
  }

  const expired = s.status !== 0;
  const K = usd(s.strike, 0);

  return (
    <>
      <Link href="/markets" className="crumb">← Markets</Link>

      <div className="mktHead">
        <div className="mktTitle">
          <h1>{s.underlyingSymbol} at {K}</h1>
          <div className="tokens">
            <span className={`pill ${s.status === 0 ? "open" : s.status === 3 ? "claimable" : ""}`}>
              {STATUS_LABEL[s.status]}
            </span>
            <span className="tokenChip">{expiryLabel(s.expiry)}{!expired && ` · ${countdown(s.expiry)}`}</span>
            <span className="tokenChip f">{s.floorSymbol}</span>
            <span className="tokenChip u">{s.upsideSymbol}</span>
          </div>
        </div>

        <div className="mktMarks">
          <div className="mktMark">
            <span>{s.settled ? "Settled at" : "Spot"}</span>
            <b>{s.settled ? usd(s.settlementPrice) : s.priceValid ? usd(s.spotPrice) : "—"}</b>
          </div>
          {p && (
            <>
              <div className="mktMark f">
                <span>Floor pool</span>
                <b>{cash(p.floorPrice)}</b>
              </div>
              <div className="mktMark">
                <span>Upside pool</span>
                <b>{cash(p.upsidePrice)}</b>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="work">
        <div>
          <PayoffChart
            strike={s.strike}
            spot={s.priceValid ? s.spotPrice : undefined}
            settlementPrice={s.settled ? s.settlementPrice : undefined}
            underlyingSymbol={s.underlyingSymbol}
          />

          {p && <ParityLedger p={p} />}
          <Indicative s={s} />

          <div className="facts">
            <div className="factRow">
              <span>Strike</span><b>{usd(s.strike)}</b>
            </div>
            <div className="factRow">
              <span>Expiry</span><b>{expiryLabel(s.expiry)} · 16:00 New York</b>
            </div>
            <div className="factRow">
              <span>Stock in this vault</span><b>{units(s.totalDeposited)} {s.underlyingSymbol}</b>
            </div>
            <div className="factRow">
              <span>Halves outstanding</span><b>{units(s.halfSupply)} of each</b>
            </div>
            <div className="factRow">
              <span>Price feed</span>
              <b>
                <a href={explorer("address", s.feed)} target="_blank" rel="noreferrer">
                  {shortAddr(s.feed)}
                </a>
                {s.priceValid && ` · ${timeAgo(s.spotUpdatedAt)}`}
              </b>
            </div>
            <div className="factRow">
              <span>Vault</span>
              <b>
                <a href={explorer("address", s.series)} target="_blank" rel="noreferrer">
                  {shortAddr(s.series)}
                </a>
              </b>
            </div>
            {hook && (
              <div className="factRow">
                <span>Parity hook</span>
                <b>
                  <a href={explorer("address", hook)} target="_blank" rel="noreferrer">
                    {shortAddr(hook)}
                  </a>
                </b>
              </div>
            )}
            {s.settled && (
              <div className="factRow">
                <span>Final split</span>
                <b>{pct(s.floorPayoutPerUnit)} floor / {pct(s.upsidePayoutPerUnit)} upside</b>
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          {!expired && hook && <Trade s={s} />}
          {s.settled ? <Claim s={s} /> : <Split s={s} />}
          {expired && !s.settled && <Settle s={s} onDone={refresh} />}
          {!expired && !hook && (
            <div className="panel">
              <b className="panelTitle">No pools for these halves yet</b>
              <p className="explain">
                You can still split and recombine here — that is the vault, and it needs no market.
                Selling a half needs a pool, and nobody has opened one for this series.
              </p>
              <Link className="btn full" href="/markets">Find a series with a market</Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
