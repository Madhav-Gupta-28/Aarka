"use client";

import {useCallback, useState} from "react";
import {useAccount, useWriteContract} from "wagmi";
import {useQueryClient} from "@tanstack/react-query";
import type {Abi} from "viem";
import {publicClient} from "./client";
import {robinhoodTestnet} from "./chain";
import {useToast} from "./ui";

export type TxPhase = "idle" | "wallet" | "mining" | "done" | "error";

type Call = {address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[]};

/**
 * What each contract refusal means, said plainly. Keys are the custom error names in the ABIs in
 * contracts.ts; viem decodes them from the revert data when a call is simulated.
 */
const REFUSED: Record<string, string> = {
  SequencerDown: "The network's uptime check hasn't been confirmed recently, so the final price can't be carved yet. Nothing was taken. It opens again at the next check, and a week after the end date the check no longer applies.",
  SequencerGracePeriod: "The network came back less than an hour ago, and the final price waits an hour after that. Nothing was taken. Try again shortly.",
  OraclePaused: "The Sun has paused this stock's price for a corporate action, so the final price can't be carved yet. Nothing was taken.",
  CorporateActionBeforeExpiry: "A corporate action landed after The Sun's last price, so that price can't be the final one yet. Nothing was taken.",
  LaterRoundExists: "The Sun has published a newer price than the one on this page. Nothing was taken. Refresh and try again.",
  RoundTooOld: "The Sun's last price is too old to be the final one yet. Nothing was taken. A week after the end date, it is accepted at any age.",
  RoundAfterExpiry: "That price came after the end date, so it can't be the final one. Nothing was taken. Refresh and try again.",
  AlreadySettled: "Someone has already carved the final price. Nothing was taken. Refresh to see it.",
  NotExpired: "This split hasn't ended yet. Nothing was taken.",
  NotSettled: "The final price hasn't been carved yet. Nothing was taken.",
  ClaimsLocked: "Collecting opens one hour after the final price is carved. Nothing was taken. Try again when the hour is up.",
  Expired: "This split has ended, so it can't be split any more. Nothing was taken. You can still put pairs back together.",
  FaucetCooldown: "You claimed these within the last hour. Nothing was taken. Try again when the timer runs out.",
  InsufficientOutput: "The price moved more than 0.5% before your order completed. Nothing was taken. Try again.",
  ERC20InsufficientBalance: "Your wallet holds less than that now. Nothing was taken. Try a smaller amount.",
  ERC20InsufficientAllowance: "Aarka's permission to move that token is too low. Nothing was taken. Give permission again, then retry.",
};

/** The custom error a call reverted with, if viem could decode one. */
function errorName(e: unknown): string | undefined {
  const walk = (e as {walk?: (fn: (x: unknown) => boolean) => unknown})?.walk;
  const hit = walk?.call(e, (x) => !!(x as {data?: {errorName?: string}})?.data?.errorName) as {data?: {errorName?: string}} | undefined;
  return hit?.data?.errorName;
}

/** A friendly reason, in the voice of the error pattern: what happened, is my money fine, what now. */
export function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/user rejected|denied|rejected the request/i.test(m)) return "You cancelled in your wallet. Nothing was taken.";
  const named = errorName(e);
  if (named && REFUSED[named]) return REFUSED[named];
  if (/chain|network/i.test(m) && /mismatch|switch|wrong/i.test(m)) return "Your wallet is on a different network. Switch in one tap and try again.";
  // Only a real shortfall. Every revert caught while estimating gas carries the word "gas" in its
  // message, so matching on that alone told people with full wallets they were out of ETH.
  if (/insufficient funds|exceeds (the )?balance|total cost .* exceeds/i.test(m)) return "Your wallet doesn't have enough ETH for the network fee. Nothing was taken.";
  if (/InsufficientOutput|slippage/i.test(m)) return "The price moved more than 0.5% before your order completed. Nothing was taken. Try again.";
  if (/revert/i.test(m)) return "The network would refuse this right now, so nothing was sent and nothing was taken. Refresh and try again.";
  return "That didn't go through. Nothing was taken from your wallet. Try again; your amount is still filled in.";
}

/**
 * Send one transaction and see it through: wallet, then confirmation, then a toast.
 *
 * Every write names the testnet chain id, so a wallet on another network cannot sign it. On
 * success every read is refreshed and a toast says
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

  const run = useCallback(async (call: Call, done?: {toast: string; body?: string}) => {
    setError(null);
    setPhase("wallet");
    try {
      // Ask the chain first. A call it would refuse fails here, with its reason decoded, before
      // the wallet opens or any fee is paid.
      if (address) await publicClient.simulateContract({...call, account: address} as never);
      const h = await writeContractAsync({...call, chainId: robinhoodTestnet.id} as never);
      setHash(h);
      setPhase("mining");
      const r = await publicClient.waitForTransactionReceipt({hash: h});
      if (r.status !== "success") throw new Error("reverted");
      setPhase("done");
      await qc.invalidateQueries();
      if (done) {
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
