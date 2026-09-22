"use client";

import Link from "next/link";
import {useAccount} from "wagmi";
import {useData} from "@/components/DataProvider";
import {Settle} from "@/components/Settle";
import {Claim} from "@/components/Claim";
import {usd, pct, expiryLabel, countdown, duration, units} from "@/lib/format";
import {STATUS} from "@/lib/types";

/**
 * The settlement queue.
 *
 * Settlement here is permissionless and unrewarded: anyone can call it, and the result is the same
 * whoever does. That only means anything if there is somewhere to see what is waiting, so this is
 * that place — expired and unsettled at the top, then the challenge window, then what can be
 * claimed.
 */
export default function SettlePage() {
  const {series, positions, refresh} = useData();
  const {isConnected} = useAccount();

  if (!series) return <div className="loading">Reading the chain…</div>;

  const awaiting = series.filter((s) => s.status === STATUS.Expired);
  const challenging = series.filter((s) => s.status === STATUS.Challenging);
  const claimable = series.filter((s) => s.status === STATUS.Claimable && s.halfSupply > 0n);
  const next = series
    .filter((s) => s.status === STATUS.Open)
    .sort((a, b) => Number(a.expiry - b.expiry))[0];

  const holds = (addr: string) => {
    const p = positions.find((x) => x.series.toLowerCase() === addr.toLowerCase());
    return !!p && (p.floorBalance > 0n || p.upsideBalance > 0n);
  };

  return (
    <>
      <div className="pageHead">
        <div>
          <span className="eyebrow">Settlement</span>
          <h1>Anyone can close a series</h1>
          <p>
            The contract never reads "the latest price". Whoever settles names a feed round, and the
            contract proves it is the last one published at or before expiry. That makes settling a
            chore rather than a privilege — which is the point.
          </p>
        </div>
      </div>

      {awaiting.length === 0 && challenging.length === 0 && claimable.length === 0 && (
        <div className="empty">
          <b>Nothing to settle</b>
          <p>
            {next
              ? `Every series is still open. The next to expire is ${next.underlyingSymbol} ${usd(next.strike, 0)} on ${expiryLabel(next.expiry)}, in ${countdown(next.expiry)}.`
              : "No series are waiting."}
          </p>
          <Link className="btn" href="/markets">Browse markets</Link>
        </div>
      )}

      {awaiting.length > 0 && (
        <section className="section" style={{marginTop: 0}}>
          <div className="sectionHead">
            <h2>Expired, waiting for someone to settle</h2>
            <span>{awaiting.length} {awaiting.length === 1 ? "series" : "series"}</span>
          </div>
          <div className="queue">
            {awaiting.map((s) => (
              <div className="qRow due" key={s.series}>
                <div className="qTop">
                  <b>{s.underlyingSymbol} {usd(s.strike, 0)}</b>
                  <span className="tokenChip">expired {expiryLabel(s.expiry)}</span>
                  <span className="tokenChip">{units(s.halfSupply)} of each half outstanding</span>
                </div>
                <Settle s={s} onDone={refresh} />
              </div>
            ))}
          </div>
        </section>
      )}

      {challenging.length > 0 && (
        <section className="section">
          <div className="sectionHead">
            <h2>Settled, in the challenge window</h2>
            <span>payouts are held until it closes</span>
          </div>
          <div className="queue">
            {challenging.map((s) => {
              const left = Number(s.claimsUnlockAt) - Math.floor(Date.now() / 1000);
              return (
                <div className="qRow" key={s.series}>
                  <div className="qTop">
                    <b>{s.underlyingSymbol} {usd(s.strike, 0)}</b>
                    <span className="tokenChip">settled at {usd(s.settlementPrice)}</span>
                    <span className="tokenChip">{pct(s.floorPayoutPerUnit)} / {pct(s.upsidePayoutPerUnit)}</span>
                  </div>
                  <p className="explain" style={{marginBottom: 0}}>
                    Claims unlock in {duration(left)}. Until then anyone can replace this settlement
                    with a strictly later qualifying round, so the payout is not final yet.
                    Recombining is unaffected and works right now.
                  </p>
                  <div className="linkRow">
                    <Link href={`/markets/${s.series}`}>Open market →</Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {claimable.length > 0 && (
        <section className="section">
          <div className="sectionHead">
            <h2>Final, ready to claim</h2>
            <span>{isConnected ? "yours are shown first" : "connect to claim"}</span>
          </div>
          <div className="queue">
            {[...claimable]
              .sort((a, b) => Number(holds(b.series)) - Number(holds(a.series)))
              .map((s) => (
                <div className="qRow" key={s.series}>
                  <div className="qTop">
                    <b>{s.underlyingSymbol} {usd(s.strike, 0)}</b>
                    <span className="tokenChip">{expiryLabel(s.expiry)}</span>
                    {holds(s.series) && <span className="pill claimable">you hold this</span>}
                  </div>
                  <Claim s={s} />
                </div>
              ))}
          </div>
        </section>
      )}
    </>
  );
}
