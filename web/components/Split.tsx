"use client";

import {useEffect, useState} from "react";
import {useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract} from "wagmi";
import {formatUnits, parseUnits, maxUint256} from "viem";
import {SERIES_ABI, TOKEN_ABI} from "@/lib/contracts";
import {robinhoodTestnet} from "@/lib/chain";
import {units} from "@/lib/format";
import type {SeriesView} from "@/lib/types";

/**
 * Mint and redeem for one series.
 *
 * Mint takes two transactions the first time — an approval, then the deposit. The button says so
 * rather than silently firing two wallet prompts, because an unexplained second prompt is where
 * people abandon.
 */
export function Split({s}: {s: SeriesView}) {
  const {address, isConnected} = useAccount();
  const [amount, setAmount] = useState("10");
  const [mode, setMode] = useState<"mint" | "redeem">("mint");

  const {data: bal, refetch: refetchBal} = useReadContract({
    address: s.underlying, abi: TOKEN_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: {enabled: !!address},
  });
  const {data: allowance, refetch: refetchAllow} = useReadContract({
    address: s.underlying, abi: TOKEN_ABI, functionName: "allowance",
    args: address ? [address, s.series] : undefined, query: {enabled: !!address},
  });
  const {data: floorBal, refetch: refetchF} = useReadContract({
    address: s.floorToken, abi: TOKEN_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: {enabled: !!address},
  });
  const {data: upsideBal, refetch: refetchU} = useReadContract({
    address: s.upsideToken, abi: TOKEN_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: {enabled: !!address},
  });

  const {writeContract, data: hash, isPending, reset} = useWriteContract();
  const {isLoading: mining, isSuccess} = useWaitForTransactionReceipt({hash});

  useEffect(() => {
    if (!isSuccess) return;
    refetchBal(); refetchAllow(); refetchF(); refetchU(); reset();
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  let wei = 0n;
  try { wei = parseUnits(amount || "0", 18); } catch {}

  const needsApproval = mode === "mint" && (allowance ?? 0n) < wei;
  const redeemable = floorBal !== undefined && upsideBal !== undefined
    ? (floorBal < upsideBal ? floorBal : upsideBal) : 0n;
  const max = mode === "mint" ? (bal ?? 0n) : redeemable;
  const tooMuch = wei > max;
  const expired = s.status !== 0;

  function go() {
    if (mode === "mint") {
      if (needsApproval) {
        writeContract({address: s.underlying, abi: TOKEN_ABI, functionName: "approve",
                       args: [s.series, maxUint256], chainId: robinhoodTestnet.id});
      } else {
        writeContract({address: s.series, abi: SERIES_ABI, functionName: "mint",
                       args: [wei, address!], chainId: robinhoodTestnet.id});
      }
    } else {
      writeContract({address: s.series, abi: SERIES_ABI, functionName: "redeem",
                     args: [wei, address!], chainId: robinhoodTestnet.id});
    }
  }

  const busy = isPending || mining;
  const label = busy
    ? (mining ? "Confirming…" : "Check your wallet…")
    : mode === "mint"
      ? (needsApproval ? `Approve ${s.underlyingSymbol}` : `Deposit ${amount || "0"} ${s.underlyingSymbol}`)
      : `Return ${amount || "0"} of each half`;

  return (
    <div className="panel">
      <div className="tabs">
        <button className={mode === "mint" ? "on" : ""} onClick={() => setMode("mint")}>Split</button>
        <button className={mode === "redeem" ? "on" : ""} onClick={() => setMode("redeem")}>Recombine</button>
      </div>

      <p className="explain">
        {mode === "mint"
          ? `Deposit ${s.underlyingSymbol} and get the same number of each half. Sell whichever one you don't want.`
          : `Return one of each half and get one ${s.underlyingSymbol} back. Works at any time, settled or not.`}
      </p>

      <div className="amountRow">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          aria-label="Amount"
        />
        <span className="sym">{mode === "mint" ? s.underlyingSymbol : "pairs"}</span>
        <button className="maxBtn" onClick={() => setAmount(formatUnits(max, 18))}>max</button>
      </div>

      <div className="balances">
        <div><span>{s.underlyingSymbol}</span><b>{units(bal ?? 0n)}</b></div>
        <div><span>{s.floorSymbol}</span><b>{units(floorBal ?? 0n)}</b></div>
        <div><span>{s.upsideSymbol}</span><b>{units(upsideBal ?? 0n)}</b></div>
      </div>

      {mode === "mint" && !expired && isConnected && wei > 0n && (
        <ol className="steps">
          <li className={needsApproval ? (busy ? "doing" : "now") : "done"}>
            <i>{needsApproval ? "1" : "✓"}</i>
            <span>Let the vault move your {s.underlyingSymbol}</span>
          </li>
          <li className={!needsApproval ? (busy ? "doing" : "now") : ""}>
            <i>2</i>
            <span>Deposit and receive both halves</span>
          </li>
        </ol>
      )}

      {mode === "mint" && expired ? (
        <button className="btn full" disabled>Series expired — splitting is closed</button>
      ) : !isConnected ? (
        <button className="btn full" disabled>Connect a wallet to continue</button>
      ) : (
        <button className="btn primary full" disabled={busy || wei === 0n || tooMuch} onClick={go}>
          {tooMuch ? "More than you hold" : label}
        </button>
      )}

      {mode === "mint" && !expired && (
        <p className="hint">
          {wei === 0n || tooMuch
            ? " "
            : needsApproval
              ? "Two transactions. The first only grants permission, nothing moves until the second."
              : `You get ${units(wei)} ${s.floorSymbol} and ${units(wei)} ${s.upsideSymbol}.`}
        </p>
      )}
    </div>
  );
}
