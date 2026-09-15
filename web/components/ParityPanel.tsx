"use client";

import {useEffect, useState} from "react";
import {useAccount, useWaitForTransactionReceipt, useWriteContract} from "wagmi";
import {maxUint256} from "viem";
import {publicClient} from "@/lib/client";
import {ADDRESSES, HOOK_LENS_ABI, TOKEN_ABI} from "@/lib/contracts";
import {robinhoodTestnet} from "@/lib/chain";

type Parity = {
  underlyingPrice: bigint; floorPrice: bigint; upsidePrice: bigint; sumOfHalves: bigint;
  gapBps: bigint; halvesDear: boolean; minDeviationBps: bigint; wired: boolean;
  quote: `0x${string}`;
};

const q = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;

const SWAP_ABI = [
  {type: "function", name: "swap", stateMutability: "payable",
   inputs: [
     {name: "key", type: "tuple", components: [
       {name: "currency0", type: "address"}, {name: "currency1", type: "address"},
       {name: "fee", type: "uint24"}, {name: "tickSpacing", type: "int24"},
       {name: "hooks", type: "address"}]},
     {name: "params", type: "tuple", components: [
       {name: "zeroForOne", type: "bool"}, {name: "amountSpecified", type: "int256"},
       {name: "sqrtPriceLimitX96", type: "uint160"}]},
     {name: "testSettings", type: "tuple", components: [
       {name: "takeClaims", type: "bool"}, {name: "settleUsingBurn", type: "bool"}]},
     {name: "hookData", type: "bytes"}],
   outputs: [{type: "int256"}]},
] as const;

/**
 * The three pools the hook watches, and a button that breaks parity on purpose.
 *
 * The point of the demo: a swap moves one half's price, which opens a gap against the underlying.
 * The hook closes it inside the same transaction, before the swap returns. So the gap you see
 * after is not what the swap created — it is what survived the hook.
 */
type Half = "floor" | "upside";

export function ParityPanel({
  floorToken, upsideToken, floorSymbol, upsideSymbol,
}: {
  floorToken: `0x${string}`; upsideToken: `0x${string}`;
  floorSymbol: string; upsideSymbol: string;
}) {
  const [half, setHalf] = useState<Half>("floor");
  const {address, isConnected} = useAccount();
  const [p, setP] = useState<Parity | null>(null);
  const [phase, setPhase] = useState<string>("idle");
  const {writeContract, data: hash, isPending, reset} = useWriteContract();
  const {isLoading: mining, isSuccess} = useWaitForTransactionReceipt({hash});

  async function load() {
    try {
      const r = (await publicClient.readContract({
        address: ADDRESSES.hookLens as `0x${string}`, abi: HOOK_LENS_ABI,
        functionName: "parity", args: [ADDRESSES.hook as `0x${string}`],
      })) as unknown as Parity;
      setP(r);
    } catch { /* leave the last good reading up */ }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isSuccess) return;
    load();
    setPhase("idle");
    reset();
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p || !p.wired) return null;

  const quote = p.quote;
  const asset = half === "floor" ? floorToken : upsideToken;
  const assetSymbol = half === "floor" ? floorSymbol : upsideSymbol;
  const assetIsZero = asset.toLowerCase() < quote.toLowerCase();

  const MIN = 4295128740n;
  const MAX = 1461446703485210103287273052203988822378723970341n;

  const key = assetIsZero
    ? {currency0: asset, currency1: quote, fee: 3000, tickSpacing: 60, hooks: ADDRESSES.hook as `0x${string}`}
    : {currency0: quote, currency1: asset, fee: 3000, tickSpacing: 60, hooks: ADDRESSES.hook as `0x${string}`};

  function approve(token: `0x${string}`, label: string) {
    setPhase(label);
    writeContract({address: token, abi: TOKEN_ABI, functionName: "approve",
                   args: [ADDRESSES.swapRouter as `0x${string}`, maxUint256], chainId: robinhoodTestnet.id});
  }

  /**
   * Buying a half pushes its price up, so the two halves become dear against the stock and the
   * hook mints to close the gap. Selling pushes it down, the halves go cheap, and the hook
   * redeems instead. Both directions of the arb exist; showing only one hides half the mechanism.
   */
  function swap(dir: "buy" | "sell") {
    setPhase(dir === "buy" ? "buying" : "selling");
    // exact-input: spend quote to receive the asset, or spend the asset to receive quote
    const zeroForOne = dir === "buy" ? !assetIsZero : assetIsZero;
    const amountSpecified = dir === "buy" ? -50_000_000_000n : -250_000_000_000_000_000_000n;
    writeContract({
      address: ADDRESSES.swapRouter as `0x${string}`, abi: SWAP_ABI, functionName: "swap",
      args: [key, {zeroForOne, amountSpecified, sqrtPriceLimitX96: zeroForOne ? MIN : MAX},
             {takeClaims: false, settleUsingBurn: false}, "0x"],
      chainId: robinhoodTestnet.id,
    });
  }

  const busy = isPending || mining;
  const atParity = p.gapBps < p.minDeviationBps;

  return (
    <div className="parity">
      <div className="sectionHead">
        <h2>The two halves have to add up</h2>
        <span>a Uniswap v4 hook keeps them honest</span>
      </div>

      <p className="explain">
        Each half trades in its own pool, so nothing in the AMM forces their prices to sum to the
        stock. A hook checks after every swap and, when they drift apart, buys the cheap side and
        sells the dear one inside the same transaction. It fronts no capital and pays what it makes
        to the liquidity providers.
      </p>

      <div className="ledger">
        <div className="lrow"><span>floor pool</span><b>{q(p.floorPrice)}</b></div>
        <div className="lrow"><span>upside pool</span><b>{q(p.upsidePrice)}</b></div>
        <div className="lrow sum"><span>together</span><b>{q(p.sumOfHalves)}</b></div>
        <div className="lrow"><span>stock pool</span><b>{q(p.underlyingPrice)}</b></div>
        <div className={`lrow gap ${atParity ? "ok" : "off"}`}>
          <span>difference</span>
          <b>{p.gapBps.toString()} bps {atParity ? "· at parity" : p.halvesDear ? "· halves dear" : "· halves cheap"}</b>
        </div>
      </div>

      {!isConnected ? (
        <button className="btn full" disabled>Connect a wallet to try it</button>
      ) : (
        <>
          <div className="tabs" style={{marginBottom: 12}}>
            <button className={half === "floor" ? "on" : ""} onClick={() => setHalf("floor")}>
              {floorSymbol}
            </button>
            <button className={half === "upside" ? "on" : ""} onClick={() => setHalf("upside")}>
              {upsideSymbol}
            </button>
          </div>

          <div className="parityBtns">
            <button className="btn" onClick={() => approve(quote, "approving quote")} disabled={busy}>
              {phase === "approving quote" && busy ? "Approving…" : "Approve USDG"}
            </button>
            <button className="btn" onClick={() => approve(asset, "approving half")} disabled={busy}>
              {phase === "approving half" && busy ? "Approving…" : `Approve ${assetSymbol}`}
            </button>
          </div>

          <div className="parityBtns" style={{marginTop: 10}}>
            <button className="btn primary" onClick={() => swap("buy")} disabled={busy}>
              {phase === "buying" && busy ? "Buying…" : `Buy $50k of ${assetSymbol}`}
            </button>
            <button className="btn primary" onClick={() => swap("sell")} disabled={busy}>
              {phase === "selling" && busy ? "Selling…" : `Sell 250 ${assetSymbol}`}
            </button>
          </div>
        </>
      )}

      <p className="hint">
        <b style={{color: "var(--paper)"}}>Buying</b> a half pushes its price up, so the two halves
        become dear against the stock and the hook <b style={{color: "var(--paper)"}}>mints</b> to
        close the gap. <b style={{color: "var(--paper)"}}>Selling</b> pushes it down, the halves go
        cheap, and the hook <b style={{color: "var(--paper)"}}>redeems</b> instead. Either way the
        gap you see afterwards is what survived the hook, not what the swap created — approve first,
        selling needs a balance of that half.
      </p>
    </div>
  );
}
