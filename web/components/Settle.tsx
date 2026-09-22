"use client";

import {useEffect, useState} from "react";
import {useWaitForTransactionReceipt, useWriteContract} from "wagmi";
import {SERIES_ABI} from "@/lib/contracts";
import {findSettlementRound, LATE_SETTLEMENT_DELAY, MAX_LOOKBACK_SECONDS, type Candidate} from "@/lib/settle";
import {usd} from "@/lib/format";
import {robinhoodTestnet} from "@/lib/chain";
import type {SeriesView} from "@/lib/types";

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
          No feed round in the 26 hours before expiry, which means the feed missed its daily
          heartbeat. A week after expiry any earlier round is accepted instead, so this series will
          still settle. Recombining works in the meantime.
        </p>
      </div>
    );
  }

  const age = Number(s.expiry - cand.updatedAt);
  const late = BigInt(Math.floor(Date.now() / 1000)) >= s.expiry + LATE_SETTLEMENT_DELAY;
  const tooOld = !late && BigInt(age) > MAX_LOOKBACK_SECONDS;
  const busy = isPending || mining;

  return (
    <div className="settleBox">
      <b>Ready to settle</b>
      <div className="rows" style={{marginTop: 10}}>
        <div className="row"><span>Round</span><b>{cand.roundId.toString()}</b></div>
        <div className="row"><span>Price</span><b>{usd(cand.price)}</b></div>
        <div className="row">
          <span>Published before expiry</span>
          <b>{age >= 3600 ? `${Math.floor(age / 3600)}h ${Math.floor((age % 3600) / 60)}m` : `${Math.floor(age / 60)} min`}</b>
        </div>
      </div>
      <p>
        The contract will check this is the last round at or before expiry,{" "}
        {late ? "that the feed still reports 8 decimals — the series is a week past expiry, so age no longer counts" : "that it is at most 26 hours old, and that the asset is not paused"}. Then it fixes the split.
      </p>
      <button
        className="btn primary full"
        disabled={busy || tooOld}
        onClick={() =>
          writeContract({address: s.series, abi: SERIES_ABI, functionName: "settle",
                         args: [cand.roundId], chainId: robinhoodTestnet.id})}
      >
        {tooOld ? "Round is outside the window" : busy ? "Settling…" : "Settle this series"}
      </button>
      <p className="hint">Permissionless — anyone can call this, and the result is the same either way.</p>
    </div>
  );
}
