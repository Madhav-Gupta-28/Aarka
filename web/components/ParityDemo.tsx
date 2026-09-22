"use client";

import {useEffect, useState} from "react";
import {useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract} from "wagmi";
import {maxUint256} from "viem";
import {ADDRESSES, ROUTER_ABI, TOKEN_ABI, hookedPoolKey, marketFor} from "@/lib/contracts";
import {robinhoodTestnet, explorer} from "@/lib/chain";
import {usd, shortAddr, expiryLabel} from "@/lib/format";
import {useData} from "./DataProvider";
import {ParityLedger} from "./ParityLedger";

/** $50k: big enough to open a gap wider than the hook's threshold on these testnet pools. */
const BUY_USDG = 50_000_000_000n;
const SELL_HALVES = 250_000_000_000_000_000_000n;

type Half = "floor" | "upside";

/**
 * Break parity on purpose, and watch the hook put it back inside the same transaction.
 *
 * The number that matters is the one *after*: it is not what the swap created, it is what survived
 * the hook. Both directions are offered because showing only the mint side hides half the
 * mechanism — buying a half makes the pair dear and the hook mints, selling makes it cheap and the
 * hook redeems.
 */
export function ParityDemo() {
  const {series, parity, refresh} = useData();
  const {address, isConnected} = useAccount();
  const [pick, setPick] = useState<string | null>(null);
  const [half, setHalf] = useState<Half>("floor");

  const markets = (series ?? []).filter((s) => s.status === 0 && !!marketFor(s.series));
  const chosen = markets.find((s) => s.series === pick) ?? markets[0];
  const p = chosen ? parity.get(chosen.series.toLowerCase()) : undefined;
  const hook = chosen ? marketFor(chosen.series) : undefined;

  const asset = chosen ? (half === "floor" ? chosen.floorToken : chosen.upsideToken) : undefined;
  const router = ADDRESSES.router as `0x${string}`;

  const {data: usdgBal} = useReadContract({
    address: ADDRESSES.usdg as `0x${string}`, abi: TOKEN_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: {enabled: !!address, refetchInterval: 10_000},
  });
  const {data: halfBal} = useReadContract({
    address: asset, abi: TOKEN_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: {enabled: !!address && !!asset, refetchInterval: 10_000},
  });
  const {data: usdgAllow} = useReadContract({
    address: ADDRESSES.usdg as `0x${string}`, abi: TOKEN_ABI, functionName: "allowance",
    args: address ? [address, router] : undefined, query: {enabled: !!address},
  });
  const {data: halfAllow} = useReadContract({
    address: asset, abi: TOKEN_ABI, functionName: "allowance",
    args: address ? [address, router] : undefined, query: {enabled: !!address && !!asset},
  });

  const {writeContract, data: hash, isPending, reset} = useWriteContract();
  const {isLoading: mining, isSuccess} = useWaitForTransactionReceipt({hash});

  useEffect(() => {
    if (!isSuccess) return;
    refresh();
    reset();
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!chosen || !p || !hook || !asset) return null;

  const {key, assetIsZero} = hookedPoolKey(asset, hook);
  const sellAmount = (halfBal ?? 0n) < SELL_HALVES ? (halfBal ?? 0n) : SELL_HALVES;
  const busy = isPending || mining;
  const canBuy = (usdgBal ?? 0n) >= BUY_USDG;
  const needUsdg = (usdgAllow ?? 0n) < BUY_USDG;
  const needHalf = (halfAllow ?? 0n) < sellAmount;
  const symbol = half === "floor" ? chosen.floorSymbol : chosen.upsideSymbol;

  const approve = (token: `0x${string}`) =>
    writeContract({address: token, abi: TOKEN_ABI, functionName: "approve",
                   args: [router, maxUint256], chainId: robinhoodTestnet.id});

  // No minimum output on purpose: the point is to move the price far enough to open a gap.
  const swap = (dir: "buy" | "sell") =>
    writeContract({
      address: router, abi: ROUTER_ABI, functionName: "swapExactIn",
      args: [key, dir === "buy" ? !assetIsZero : assetIsZero,
             dir === "buy" ? BUY_USDG : sellAmount, 0n, address!],
      chainId: robinhoodTestnet.id,
    });

  return (
    <section className="section">
      <div className="sectionHead">
        <h2>Break it yourself</h2>
        <span>the gap you see afterwards is what survived the hook</span>
      </div>

      <div className="filters">
        {markets.map((m) => (
          <button key={m.series} className={m.series === chosen.series ? "on" : ""}
                  onClick={() => setPick(m.series)}>
            {m.underlyingSymbol} {usd(m.strike, 0)} · {expiryLabel(m.expiry).slice(0, 6)}
          </button>
        ))}
      </div>

      <ParityLedger p={p} />

      <div className="tabs" style={{marginBottom: 14}}>
        <button className={half === "floor" ? "on" : ""} onClick={() => setHalf("floor")}>
          {chosen.floorSymbol}
        </button>
        <button className={half === "upside" ? "on" : ""} onClick={() => setHalf("upside")}>
          {chosen.upsideSymbol}
        </button>
      </div>

      {!isConnected ? (
        <button className="btn full" disabled>Connect a wallet to try it</button>
      ) : (
        <div className="parityBtns">
          {needUsdg ? (
            <button className="btn" disabled={busy}
                    onClick={() => approve(ADDRESSES.usdg as `0x${string}`)}>
              Approve USDG
            </button>
          ) : (
            <button className="btn" disabled={busy || !canBuy} onClick={() => swap("buy")}>
              {canBuy ? `Buy $50k of ${symbol}` : "Mint USDG on the faucet page first"}
            </button>
          )}
          {needHalf ? (
            <button className="btn" disabled={busy || sellAmount === 0n} onClick={() => approve(asset)}>
              Approve {symbol}
            </button>
          ) : (
            <button className="btn" disabled={busy || sellAmount === 0n} onClick={() => swap("sell")}>
              {sellAmount === 0n ? `Split a share to hold ${symbol}` : `Sell your ${symbol}`}
            </button>
          )}
        </div>
      )}

      <p className="hint">
        Buying a half pushes its price up, so the pair goes dear against the stock and the hook
        <b> mints</b> to close the gap. Selling pushes it down, the pair goes cheap, and the hook
        <b> redeems</b> instead. It fronts no capital either way — every leg settles inside one
        Uniswap lock.{" "}
        <a href={explorer("address", hook)} target="_blank" rel="noreferrer">
          hook {shortAddr(hook)}
        </a>
      </p>
    </section>
  );
}
