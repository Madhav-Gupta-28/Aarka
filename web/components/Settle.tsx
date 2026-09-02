"use client";

import {useEffect, useState} from "react";
import {useWaitForTransactionReceipt, useWriteContract} from "wagmi";
import {SERIES_ABI} from "@/lib/contracts";
import {findSettlementRound, MAX_LOOKBACK_SECONDS, type Candidate} from "@/lib/settle";
import {usd} from "@/lib/format";
import type {SeriesView} from "./SeriesCard";

/**
 * Anyone can settle. The contract does not read the latest price — the caller names a round and
 * the contract proves it is the last one at or before expiry. So the work here is finding it,
 * and showing the reader why that particular round is the only one that qualifies.
 */
export function Settle({s, onDone}: {s: SeriesView; onDone?: () => void}) {
  const [cand, setCand] = useState<Candidate | null | "searching">("searching");
  const {writeContract, data: hash, isPending, reset} = useWriteContract();
  const {isLoading: mining, isSuccess} = useWaitForTransactionReceipt({hash});

  useEffect(() => {
    findSettlementRound(s.feed, s.expiry).then(setCand).catch(() => setCand(null));
  }, [s.feed, s.expiry]);

  useEffect(() => {
    if (isSuccess) { onDone?.(); reset(); }
  }, [isSuccess, onDone, reset]);

  if (cand === "searching") return <div className="settleBox"><p>Looking for the settlement round…</p></div>;

  if (!cand) {
    return (
      <div className="settleBox">
        <b>Not settleable yet</b>
        <p>
          No feed round exists in the six hours before expiry. That is the guard working — while a
          feed is not publishing there is no price to settle against, and a stale one would be
          worse than waiting. Recombining still works, so nothing is stuck.
        </p>
      </div>
    );
  }

  const age = Number(s.expiry - cand.updatedAt);
  const tooOld = BigInt(age) > MAX_LOOKBACK_SECONDS;
  const busy = isPending || mining;

  return (
    <div className="settleBox">
      <b>Ready to settle</b>
      <div className="rows" style={{marginTop: 10}}>
        <div className="row"><span>Round</span><b>{cand.roundId.toString()}</b></div>
        <div className="row"><span>Price</span><b>{usd(cand.price)}</b></div>
        <div className="row">
          <span>Published before expiry</span>
          <b>{Math.floor(age / 60)} min</b>
        </div>
      </div>
      <p>
        The contract will check this is the last round at or before expiry, that it is inside the
        six-hour window, and that the feed still reports 8 decimals. Then it fixes the split.
      </p>
      <button
        className="btn primary full"
        disabled={busy || tooOld}
        onClick={() =>
          writeContract({address: s.series, abi: SERIES_ABI, functionName: "settle",
                         args: [cand.roundId]})}
      >
        {tooOld ? "Round is outside the window" : busy ? "Settling…" : "Settle this series"}
      </button>
      <p className="hint">Permissionless — anyone can call this, and the result is the same either way.</p>
    </div>
  );
}
