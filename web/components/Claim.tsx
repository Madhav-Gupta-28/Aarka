"use client";

import {useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract} from "wagmi";
import {SERIES_ABI, TOKEN_ABI} from "@/lib/contracts";
import {units, usd, pct} from "@/lib/format";
import type {SeriesView} from "./SeriesCard";

/** Burn a half, take its share of the vault. Both legs round down; the dust stays behind. */
export function Claim({s}: {s: SeriesView}) {
  const {address, isConnected} = useAccount();
  const {data: fBal, refetch: rf} = useReadContract({
    address: s.floorToken, abi: TOKEN_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: {enabled: !!address},
  });
  const {data: uBal, refetch: ru} = useReadContract({
    address: s.upsideToken, abi: TOKEN_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: {enabled: !!address},
  });
  const {writeContract, data: hash, isPending, reset} = useWriteContract();
  const {isLoading: mining, isSuccess} = useWaitForTransactionReceipt({hash});
  if (isSuccess) { rf(); ru(); reset(); }

  const locked = s.status === 2;
  const unlockIn = Math.max(0, Number(s.claimsUnlockAt) - Math.floor(Date.now() / 1000));
  const busy = isPending || mining;

  const floorOut = fBal ? (fBal * s.floorPayoutPerUnit) / 10n ** 18n : 0n;
  const upsideOut = uBal ? (uBal * s.upsidePayoutPerUnit) / 10n ** 18n : 0n;

  return (
    <div className="panel">
      <b className="panelTitle">Settled at {usd(s.settlementPrice)}</b>
      <p className="explain">
        Every {s.underlyingSymbol} in the vault is now split {pct(s.floorPayoutPerUnit)} to the
        floor and {pct(s.upsidePayoutPerUnit)} to the upside. Those two add to exactly 100% — not
        approximately, by construction.
      </p>

      {locked && (
        <div className="lockNote">
          Claims unlock in {Math.ceil(unlockIn / 60)} min. During this window anyone can replace the
          settlement with a strictly later round, so payouts are held until it closes. Recombining
          is unaffected.
        </div>
      )}

      <div className="claimRow">
        <div>
          <span>{s.floorSymbol}</span>
          <b>{units(fBal ?? 0n)}</b>
          <em>→ {units(floorOut)} {s.underlyingSymbol}</em>
        </div>
        <button
          className="btn"
          disabled={!isConnected || busy || locked || !fBal}
          onClick={() => writeContract({address: s.series, abi: SERIES_ABI,
                                        functionName: "claimFloor", args: [fBal!, address!]})}
        >
          Claim floor
        </button>
      </div>

      <div className="claimRow">
        <div>
          <span>{s.upsideSymbol}</span>
          <b>{units(uBal ?? 0n)}</b>
          <em>→ {units(upsideOut)} {s.underlyingSymbol}</em>
        </div>
        <button
          className="btn"
          disabled={!isConnected || busy || locked || !uBal}
          onClick={() => writeContract({address: s.series, abi: SERIES_ABI,
                                        functionName: "claimUpside", args: [uBal!, address!]})}
        >
          Claim upside
        </button>
      </div>

      {uBal !== undefined && uBal > 0n && upsideOut === 0n && (
        <p className="hint">
          This upside token expired below the strike, so it is worth nothing. Claiming still works —
          it burns the token rather than reverting, so it does not sit in your wallet forever.
        </p>
      )}
    </div>
  );
}
