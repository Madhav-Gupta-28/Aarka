"use client";

import {useEffect, useState} from "react";
import {useAccount, useWaitForTransactionReceipt, useWriteContract} from "wagmi";
import {maxUint256} from "viem";
import {publicClient} from "@/lib/client";
import {ADDRESSES, HOOK_LENS_ABI, TOKEN_ABI} from "@/lib/contracts";

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
export function ParityPanel({floorToken}: {floorToken: `0x${string}`}) {
  const {address, isConnected} = useAccount();
  const [p, setP] = useState<Parity | null>(null);
  const [phase, setPhase] = useState<"idle" | "approving" | "swapping">("idle");
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
    if (phase === "approving") { setPhase("idle"); }
    reset();
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p || !p.wired) return null;

  const quote = p.quote;
  const zeroForOne = quote.toLowerCase() < floorToken.toLowerCase();
  const LIMIT = zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n;
  const key = zeroForOne
    ? {currency0: quote, currency1: floorToken, fee: 3000, tickSpacing: 60, hooks: ADDRESSES.hook as `0x${string}`}
    : {currency0: floorToken, currency1: quote, fee: 3000, tickSpacing: 60, hooks: ADDRESSES.hook as `0x${string}`};

  function approve() {
    setPhase("approving");
    writeContract({address: quote, abi: TOKEN_ABI, functionName: "approve",
                   args: [ADDRESSES.swapRouter as `0x${string}`, maxUint256]});
  }

  function breakParity() {
    setPhase("swapping");
    writeContract({
      address: ADDRESSES.swapRouter as `0x${string}`, abi: SWAP_ABI, functionName: "swap",
      args: [key, {zeroForOne, amountSpecified: -50_000_000_000n, sqrtPriceLimitX96: LIMIT},
             {takeClaims: false, settleUsingBurn: false}, "0x"],
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
        <div className="parityBtns">
          <button className="btn" onClick={approve} disabled={busy}>
            {phase === "approving" && busy ? "Approving…" : "1 · Approve USDG"}
          </button>
          <button className="btn primary" onClick={breakParity} disabled={busy}>
            {phase === "swapping" && busy ? "Swapping…" : "2 · Buy $50k of the floor half"}
          </button>
        </div>
      )}

      <p className="hint">
        That swap moves the floor pool hard enough to open a gap of several hundred basis points.
        Watch the difference row — the hook has already closed it by the time the transaction
        returns, so what you see is what survived, not what the swap created.
      </p>
    </div>
  );
}
