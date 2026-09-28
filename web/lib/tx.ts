"use client";

import {useCallback, useState} from "react";
import {useAccount, useWriteContract} from "wagmi";
import {useQueryClient} from "@tanstack/react-query";
import type {Abi} from "viem";
import {publicClient} from "./client";
import {robinhoodTestnet} from "./chain";
import {addReceipt, useToast, type Receipt} from "./ui";

export type TxPhase = "idle" | "wallet" | "mining" | "done" | "error";

type Call = {address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[]};

/** A friendly reason, in the voice of the error pattern: what happened, is my money fine, what now. */
export function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/user rejected|denied|rejected the request/i.test(m)) return "You cancelled in your wallet. Nothing was taken.";
  if (/chain|network/i.test(m) && /mismatch|switch|wrong/i.test(m)) return "Your wallet is on a different network. Switch in one tap and try again.";
  if (/insufficient funds|gas/i.test(m)) return "Your wallet doesn't have enough ETH for the network fee. Nothing was taken.";
  if (/InsufficientOutput|slippage/i.test(m)) return "The price moved more than 0.5% before your order completed. Nothing was taken. Try again.";
  return "That didn't go through. Nothing was taken from your wallet. Try again; your amount is still filled in.";
}

/**
 * Send one transaction and see it through: wallet, then confirmation, then a receipt.
 *
 * Every write names the testnet chain id, so a wallet on another network cannot sign it. On
 * success every read is refreshed, the receipt goes into this wallet's history, and a toast says
 * what changed.
 */
export function useTx() {
  const {address} = useAccount();
  const {writeContractAsync} = useWriteContract();
  const qc = useQueryClient();
  const toast = useToast();
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);

  const run = useCallback(async (call: Call, done?: {toast: string; body?: string; receipt?: Omit<Receipt, "at" | "hash">}) => {
    setError(null);
    setPhase("wallet");
    try {
      const h = await writeContractAsync({...call, chainId: robinhoodTestnet.id} as never);
      setHash(h);
      setPhase("mining");
      const r = await publicClient.waitForTransactionReceipt({hash: h});
      if (r.status !== "success") throw new Error("reverted");
      setPhase("done");
      await qc.invalidateQueries();
      if (done) {
        if (done.receipt && address) addReceipt(address, {...done.receipt, at: Date.now(), hash: h});
        toast({title: done.toast, body: done.body, tone: "up"});
      }
      return h;
    } catch (e) {
      const msg = explain(e);
      setError(msg);
      setPhase("error");
      toast({title: "That didn't go through", body: msg, tone: "down"});
      return null;
    }
  }, [writeContractAsync, qc, toast, address]);

  /** A step that failed before anything was sent, such as a quote that could not be simulated. */
  const fail = useCallback((e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    const msg = /InsufficientOutput|liquidity|PriceLimit/i.test(m)
      ? "The pool can't fill that much right now. Nothing was taken. Try a smaller amount."
      : explain(e);
    setError(msg);
    setPhase("error");
    toast({title: "That didn't go through", body: msg, tone: "down"});
    return null;
  }, [toast]);

  const reset = useCallback(() => { setPhase("idle"); setError(null); setHash(null); }, []);

  return {run, fail, phase, error, hash, reset, busy: phase === "wallet" || phase === "mining"};
}

export const explorerTx = (h: string) => `${robinhoodTestnet.blockExplorers.default.url}/tx/${h}`;
export const explorerAddr = (a: string) => `${robinhoodTestnet.blockExplorers.default.url}/address/${a}`;
