"use client";

import {useEffect, useState} from "react";
import {useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract} from "wagmi";
import {formatUnits, maxUint256, parseUnits} from "viem";
import {publicClient} from "@/lib/client";
import {robinhoodTestnet} from "@/lib/chain";
import {ADDRESSES, HOOK_LENS_ABI, ROUTER_ABI, TOKEN_ABI, hookedPoolKey} from "@/lib/contracts";
import {units} from "@/lib/format";
import type {SeriesView} from "./SeriesCard";

type Mode = "sellUpside" | "sellFloor" | "buyUpside";

/** Quotes move between the quote and the signature. The call reverts past this. */
const SLIPPAGE_BPS = 50n;
const FEE_BPS = 30n;

const cash = (v: bigint) =>
  `${(Number(v) / 1e6).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDG`;

/**
 * The headline, made real: keep one half of a stock and sell the other, in one transaction.
 *
 * Everything goes through AarkaRouter against the series' own pools, so the parity hook sees these
 * trades like any other. The number shown before signing is an estimate from the pool price; the
 * minimum the transaction accepts comes from simulating the exact call a moment before it is sent.
 */
export function Trade({s, onPickMarket}: {s: SeriesView; onPickMarket?: () => void}) {
  const {address, isConnected} = useAccount();
  const [mode, setMode] = useState<Mode>("sellUpside");
  const [amount, setAmount] = useState("10");
  const [price, setPrice] = useState<{floor: bigint; upside: bigint} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  const hasMarket = s.series.toLowerCase() === ADDRESSES.hookSeries.toLowerCase();
  const buying = mode === "buyUpside";
  const payToken = (buying ? ADDRESSES.usdg : s.underlying) as `0x${string}`;
  const payDecimals = buying ? 6 : 18;
  const router = ADDRESSES.router as `0x${string}`;

  const {data: payBal, refetch: refetchBal} = useReadContract({
    address: payToken, abi: TOKEN_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: {enabled: !!address && hasMarket},
  });
  const {data: allowance, refetch: refetchAllow} = useReadContract({
    address: payToken, abi: TOKEN_ABI, functionName: "allowance",
    args: address ? [address, router] : undefined, query: {enabled: !!address && hasMarket},
  });

  const {writeContract, data: hash, isPending, reset} = useWriteContract();
  const {isLoading: mining, isSuccess} = useWaitForTransactionReceipt({hash});

  useEffect(() => {
    if (!hasMarket) return;
    let live = true;
    const load = async () => {
      try {
        const p = (await publicClient.readContract({
          address: ADDRESSES.hookLens as `0x${string}`, abi: HOOK_LENS_ABI, functionName: "parity",
          args: [ADDRESSES.hook as `0x${string}`],
        })) as unknown as {floorPrice: bigint; upsidePrice: bigint};
        if (live) setPrice({floor: p.floorPrice, upside: p.upsidePrice});
      } catch { /* keep the last reading */ }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [hasMarket]);

  useEffect(() => {
    if (!isSuccess) return;
    refetchBal(); refetchAllow(); reset();
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasMarket) {
    return (
      <div className="panel tradePanel">
        <b className="panelTitle">No market for this series yet</b>
        <p className="explain">
          On testnet one series has pools for its halves: NVDA $210, expiring 30 Oct. You can still
          split this one and hold both halves, or recombine them.
        </p>
        {onPickMarket && <button className="btn" onClick={onPickMarket}>Open NVDA $210 · 30 Oct</button>}
      </div>
    );
  }

  let wei = 0n;
  try { wei = parseUnits(amount || "0", payDecimals); } catch {}

  const K = `$${(Number(s.strike) / 1e8).toFixed(0)}`;
  const tooMuch = payBal !== undefined && wei > payBal;
  const needsApproval = (allowance ?? 0n) < wei;
  const expired = s.status !== 0;

  // Estimate from the pool price, less the fee. Good enough to show; the real minimum is simulated.
  const px = mode === "sellFloor" ? price?.floor : price?.upside;
  const estimate = !px || wei === 0n ? 0n
    : buying ? (wei * 10n ** 18n / px) * (10_000n - FEE_BPS) / 10_000n
      : (wei * px / 10n ** 18n) * (10_000n - FEE_BPS) / 10_000n;

  const soldToken = mode === "sellFloor" ? s.floorToken : s.upsideToken;
  const {key, assetIsZero} = hookedPoolKey(buying ? s.upsideToken : soldToken);

  async function go() {
    setError(null);
    if (needsApproval) {
      writeContract({address: payToken, abi: TOKEN_ABI, functionName: "approve",
                     args: [router, maxUint256], chainId: robinhoodTestnet.id});
      return;
    }
    setQuoting(true);
    try {
      if (buying) {
        // Paying USDG for the upside: the asset is what comes out.
        const zeroForOne = !assetIsZero;
        const {result} = await publicClient.simulateContract({
          address: router, abi: ROUTER_ABI, functionName: "swapExactIn",
          args: [key, zeroForOne, wei, 0n, address!], account: address!,
        });
        const min = (result as bigint) * (10_000n - SLIPPAGE_BPS) / 10_000n;
        writeContract({address: router, abi: ROUTER_ABI, functionName: "swapExactIn",
                       args: [key, zeroForOne, wei, min, address!], chainId: robinhoodTestnet.id});
      } else {
        const sellUpside = mode === "sellUpside";
        const {result} = await publicClient.simulateContract({
          address: router, abi: ROUTER_ABI, functionName: "splitAndSell",
          args: [s.series, sellUpside, wei, key, 0n, address!], account: address!,
        });
        const min = (result as bigint) * (10_000n - SLIPPAGE_BPS) / 10_000n;
        writeContract({address: router, abi: ROUTER_ABI, functionName: "splitAndSell",
                       args: [s.series, sellUpside, wei, key, min, address!], chainId: robinhoodTestnet.id});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "The quote failed. Try a smaller amount.");
    } finally {
      setQuoting(false);
    }
  }

  const busy = isPending || mining || quoting;
  const paySym = buying ? "USDG" : s.underlyingSymbol;
  const label = busy
    ? (quoting ? "Quoting…" : mining ? "Confirming…" : "Check your wallet…")
    : needsApproval ? `Approve ${paySym}`
      : mode === "sellUpside" ? "Keep the floor, sell the upside"
        : mode === "sellFloor" ? "Keep the upside, sell the floor"
          : "Buy the upside";

  return (
    <div className="panel tradePanel">
      <div className="tabs">
        <button className={mode === "sellUpside" ? "on" : ""} onClick={() => { setMode("sellUpside"); setAmount("10"); }}>Sell upside</button>
        <button className={mode === "sellFloor" ? "on" : ""} onClick={() => { setMode("sellFloor"); setAmount("10"); }}>Sell floor</button>
        <button className={mode === "buyUpside" ? "on" : ""} onClick={() => { setMode("buyUpside"); setAmount("500"); }}>Buy upside</button>
      </div>

      <p className="explain">
        {mode === "sellUpside" && <>Deposit {s.underlyingSymbol}, keep the floor, and get paid now for everything above {K}. One transaction.</>}
        {mode === "sellFloor" && <>Deposit {s.underlyingSymbol}, keep only what it earns above {K}, and take the rest of its value in cash now.</>}
        {mode === "buyUpside" && <>Pay for everything {s.underlyingSymbol} earns above {K} by expiry. No borrowing and nothing to liquidate — if it finishes below {K}, it pays nothing.</>}
      </p>

      <div className="amountRow">
        <input id="trade-amount" value={amount} inputMode="decimal" aria-label="Amount"
               onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
        <span className="sym">{paySym}</span>
        <button className="maxBtn" onClick={() => setAmount(formatUnits(payBal ?? 0n, payDecimals))}>max</button>
      </div>

      <div className="balances">
        <div><span>You hold</span><b>{buying ? cash(payBal ?? 0n) : `${units(payBal ?? 0n)} ${paySym}`}</b></div>
        <div>
          <span>{buying ? "You get about" : "You keep"}</span>
          <b>{buying ? `${units(estimate)} ${s.upsideSymbol}` : `${units(wei)} ${mode === "sellUpside" ? s.floorSymbol : s.upsideSymbol}`}</b>
        </div>
        {!buying && <div><span>And receive about</span><b>{cash(estimate)}</b></div>}
      </div>

      {expired ? (
        <button className="btn full" disabled>Series expired — trading through the router is closed</button>
      ) : !isConnected ? (
        <button className="btn full" disabled>Connect a wallet to continue</button>
      ) : (
        <button className="btn primary full" disabled={busy || wei === 0n || tooMuch} onClick={go}>
          {tooMuch ? "More than you hold" : label}
        </button>
      )}

      <p className="hint">
        {error ?? (needsApproval && wei > 0n
          ? "Two transactions the first time: permission for the router, then the trade."
          : "Quoted by simulating the exact trade just before you sign; it reverts if the price moves more than 0.5%.")}
      </p>
    </div>
  );
}
