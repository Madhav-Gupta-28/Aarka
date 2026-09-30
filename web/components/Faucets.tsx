"use client";

import {useAccount, useReadContract} from "wagmi";
import {robinhoodTestnet} from "@/lib/chain";
import {ADDRESSES, TOKEN_ABI} from "@/lib/contracts";
import {money, nowSec, stockName} from "@/lib/format";
import {useTx} from "@/lib/tx";
import {GearAnim} from "./Relic";

/**
 * Anyone can mint themselves the test stock a split is written on, once an hour, with no
 * permission from us, and test cash with no limit. The demo has to be runnable by a stranger.
 */
export function ShareFaucet({symbol, token, spot: px}: {symbol: string; token: `0x${string}`; spot: number}) {
  const {address, isConnected, chainId} = useAccount();
  const tx = useTx();
  const {data: last} = useReadContract({address: token, abi: TOKEN_ABI, functionName: "lastClaimed", args: address ? [address] : undefined, query: {enabled: !!address, refetchInterval: 15_000}});
  const readyAt = last ? Number(last) + 3600 : 0;
  const wait = last ? Math.max(0, readyAt - nowSec()) : 0;
  const ok = isConnected && chainId === robinhoodTestnet.id;
  return (
    <button className="btn btn-primary btn-block" disabled={!ok || tx.busy || wait > 0}
            onClick={() => tx.run({address: token, abi: TOKEN_ABI, functionName: "claim"},
              {toast: `100 practice ${stockName(symbol)} shares are yours`, body: `Worth ${money(100 * px)} at today's price, in practice.`, receipt: {title: `Got 100 practice ${stockName(symbol)} shares`, body: "Free, marked PRACTICE. They follow real prices.", amount: "100 shares", icon: "tablet"}})}>
      {tx.busy && <GearAnim size={24} />}
      {!ok ? `100 ${stockName(symbol)} · connect first` : tx.busy ? "Claiming…" : wait > 0 ? `${stockName(symbol)} again in ${Math.ceil(wait / 60)} min` : `Claim 100 ${stockName(symbol)}`}
    </button>
  );
}

export function CashFaucet() {
  const {address, isConnected, chainId} = useAccount();
  const tx = useTx();
  const ok = isConnected && chainId === robinhoodTestnet.id;
  return (
    <button className="btn btn-up btn-block" disabled={!ok || tx.busy}
            onClick={() => tx.run({address: ADDRESSES.usdg as `0x${string}`, abi: TOKEN_ABI, functionName: "mint", args: [address!, 100_000_000_000n]},
              {toast: "$100,000 in practice cash", body: "Use it to buy a Floor or an Upside.", receipt: {title: "Got $100,000 practice cash", body: "Test USDG, no value.", amount: "$100,000", icon: "cash"}})}>
      {tx.busy && <GearAnim size={24} />}{!ok ? "Connect first" : tx.busy ? "Minting…" : "Get $100,000 practice cash"}
    </button>
  );
}
