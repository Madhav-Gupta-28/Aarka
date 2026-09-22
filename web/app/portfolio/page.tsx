"use client";

import Link from "next/link";
import {useAccount, useReadContract} from "wagmi";
import {useData} from "@/components/DataProvider";
import {ADDRESSES, TOKEN_ABI, STATUS_LABEL} from "@/lib/contracts";
import {cash, units, usd, expiryLabel, countdown} from "@/lib/format";
import {Connect} from "@/components/Connect";

/**
 * Everything the connected wallet holds, marked at what the pools say the halves are worth.
 *
 * The mark is explicitly a pool price rather than a model: these halves have a market, and what
 * that market pays is the only honest number to put against a balance.
 */
export default function Portfolio() {
  const {address, isConnected} = useAccount();
  const {series, positions, parity} = useData();

  const {data: usdg} = useReadContract({
    address: ADDRESSES.usdg as `0x${string}`, abi: TOKEN_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: {enabled: !!address, refetchInterval: 12_000},
  });

  const held = positions.filter((p) => p.floorBalance > 0n || p.upsideBalance > 0n);
  const bySeries = new Map(series?.map((s) => [s.series.toLowerCase(), s]) ?? []);

  // Mark each half at its pool price. A series without a market contributes nothing, and the
  // footnote says so rather than quietly counting it as zero.
  let marked = 0n;
  let unpriced = 0;
  for (const p of held) {
    const q = parity.get(p.series.toLowerCase());
    if (!q) { unpriced += 1; continue; }
    marked += (p.floorBalance * q.floorPrice + p.upsideBalance * q.upsidePrice) / 10n ** 18n;
  }

  const claimable = held.filter((p) => {
    const s = bySeries.get(p.series.toLowerCase());
    return s?.status === 3 && (p.floorClaimable > 0n || p.upsideClaimable > 0n);
  });

  return (
    <>
      <div className="pageHead">
        <div>
          <span className="eyebrow">Portfolio</span>
          <h1>What you hold</h1>
          <p>
            Every series you have a position in, with each half marked at its pool price. Return one
            of each half at any time to get your stock back — settled or not.
          </p>
        </div>
        <div className="headSide">{!isConnected && <Connect />}</div>
      </div>

      {!isConnected ? (
        <div className="empty">
          <b>Connect a wallet</b>
          <p>Your positions are read straight from the chain. Nothing is stored here.</p>
        </div>
      ) : (
        <>
          <div className="wallet">
            <div>
              <span>Halves, marked at pool prices</span>
              <b>{cash(marked)}</b>
            </div>
            <div>
              <span>USDG</span>
              <b>{cash(usdg ?? 0n)}</b>
            </div>
            <div>
              <span>Series held</span>
              <b>{held.length}</b>
            </div>
          </div>

          {claimable.length > 0 && (
            <div className="settleBox" style={{marginBottom: 22, marginTop: 0}}>
              <b>{claimable.length} settled {claimable.length === 1 ? "series is" : "series are"} ready to claim</b>
              <p>
                Burn the half, take its share of the vault. Both legs round down and the dust stays
                behind, which is what keeps the vault solvent to the last wei.
              </p>
              <Link className="btn full" href="/settle">Go to settlement</Link>
            </div>
          )}

          {held.length === 0 ? (
            <div className="empty">
              <b>Nothing held yet</b>
              <p>
                Split a share and you will hold both halves. Sell whichever one you do not want, or
                keep both and recombine later.
              </p>
              <Link className="btn primary" href="/markets">Browse markets</Link>
            </div>
          ) : (
            <div className="holdGrid">
              {held.map((p) => {
                const s = bySeries.get(p.series.toLowerCase());
                if (!s) return null;
                const q = parity.get(p.series.toLowerCase());
                const value = q
                  ? (p.floorBalance * q.floorPrice + p.upsideBalance * q.upsidePrice) / 10n ** 18n
                  : null;
                return (
                  <div className="holdRow" key={p.series}>
                    <div className="holdTop">
                      <b>{s.underlyingSymbol} {usd(s.strike, 0)}</b>
                      <span className={`pill ${s.status === 0 ? "open" : s.status === 3 ? "claimable" : ""}`}>
                        {STATUS_LABEL[s.status]}
                      </span>
                      <span className="when">
                        {expiryLabel(s.expiry)}{s.status === 0 && ` · ${countdown(s.expiry)}`}
                      </span>
                      <div className="acts">
                        <Link className="btn" href={`/markets/${s.series}`}>Open market</Link>
                      </div>
                    </div>
                    <div className="holdCells">
                      <div className="f">
                        <span>floor</span>
                        <b>{units(p.floorBalance)}</b>
                        {q && <em>{cash((p.floorBalance * q.floorPrice) / 10n ** 18n)}</em>}
                        {s.settled && <em>→ {units(p.floorClaimable)} {s.underlyingSymbol}</em>}
                      </div>
                      <div>
                        <span>upside</span>
                        <b>{units(p.upsideBalance)}</b>
                        {q && <em>{cash((p.upsideBalance * q.upsidePrice) / 10n ** 18n)}</em>}
                        {s.settled && <em>→ {units(p.upsideClaimable)} {s.underlyingSymbol}</em>}
                      </div>
                      <div>
                        <span>recombinable</span>
                        <b>{units(p.redeemable)}</b>
                        <em>{p.redeemable > 0n ? "pairs, any time" : "need one of each"}</em>
                      </div>
                      <div>
                        <span>position value</span>
                        <b>{value === null ? "—" : cash(value)}</b>
                        <em>{value === null ? "no market" : "at pool prices"}</em>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {unpriced > 0 && (
            <p className="hint" style={{marginTop: 14}}>
              {unpriced} of these series has no market, so its halves are left out of the total
              rather than counted at zero.
            </p>
          )}
        </>
      )}
    </>
  );
}
