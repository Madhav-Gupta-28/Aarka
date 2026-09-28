"use client";

import {useState} from "react";
import {useAccount} from "wagmi";
import {SERIES_ABI} from "./contracts";
import type {SeriesView} from "./lens";
import {money, n18, n8, qty, stockName} from "./format";
import {useTx} from "./tx";

/**
 * Collect everything one wallet holds of a settled split: burn the Floors, then the Upsides, and
 * take each one's share of the vault. Paid in the stock token, so a Floor that ended below the
 * line pays out a whole share token, worth exactly what the share is worth.
 */
export function useCollect(s?: SeriesView, floorBal = 0n, upsideBal = 0n) {
  const {address} = useAccount();
  const tx = useTx();
  const [step, setStep] = useState<"idle" | "floor" | "upside">("idle");

  const px = s ? n8(s.settlementPrice) : 0;
  const floorTokens = s ? n18((floorBal * s.floorPayoutPerUnit) / 10n ** 18n) : 0;
  const upsideTokens = s ? n18((upsideBal * s.upsidePayoutPerUnit) / 10n ** 18n) : 0;
  const floorUsd = floorTokens * px;
  const upsideUsd = upsideTokens * px;
  const total = floorUsd + upsideUsd;
  const locked = !!s && s.status === 2;
  const unlockMin = s ? Math.max(0, Math.ceil((Number(s.claimsUnlockAt) - Date.now() / 1000) / 60)) : 0;

  async function collect() {
    if (!s || !address) return false;
    const name = stockName(s.underlyingSymbol);
    const receipt = {
      title: `Collected ${name} split`,
      body: `Paid ${qty(floorTokens + upsideTokens, 4)} ${s.underlyingSymbol} share tokens at the final price of ${money(px)}.`,
      amount: "+" + money(total), icon: "stele" as const,
    };
    if (floorBal > 0n) {
      setStep("floor");
      const h = await tx.run({address: s.series, abi: SERIES_ABI, functionName: "claimFloor", args: [floorBal, address]},
                             upsideBal > 0n ? undefined : {toast: `You collected ${money(total)}`, body: `Paid in ${s.underlyingSymbol} share tokens.`, receipt});
      if (!h) { setStep("idle"); return false; }
    }
    if (upsideBal > 0n) {
      setStep("upside");
      const h = await tx.run({address: s.series, abi: SERIES_ABI, functionName: "claimUpside", args: [upsideBal, address]},
                             {toast: `You collected ${money(total)}`, body: `Paid in ${s.underlyingSymbol} share tokens.`, receipt});
      if (!h) { setStep("idle"); return false; }
    }
    setStep("idle");
    return true;
  }

  return {collect, step, busy: tx.busy, phase: tx.phase, error: tx.error, hash: tx.hash,
          px, floorTokens, upsideTokens, floorUsd, upsideUsd, total, locked, unlockMin,
          txCount: (floorBal > 0n ? 1 : 0) + (upsideBal > 0n ? 1 : 0)};
}
