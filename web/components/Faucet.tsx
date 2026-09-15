"use client";

import {useEffect} from "react";
import {useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract} from "wagmi";
import {ADDRESSES, TOKEN_ABI} from "@/lib/contracts";
import {FAUCET_URL, robinhoodTestnet} from "@/lib/chain";

/**
 * Anyone can mint themselves the test stock a series is written on, once an hour, with no
 * permission from us.
 * That is deliberate: the demo has to be runnable by a stranger without asking.
 */
export function Faucet({symbol, token}: {symbol: string; token: `0x${string}`}) {
  const {address, isConnected} = useAccount();
  const {data: last, refetch} = useReadContract({
    address: token, abi: TOKEN_ABI, functionName: "lastClaimed",
    args: address ? [address] : undefined, query: {enabled: !!address},
  });
  const {writeContract, data: hash, isPending, reset} = useWriteContract();
  const {isLoading: mining, isSuccess} = useWaitForTransactionReceipt({hash});
  useEffect(() => {
    if (isSuccess) { refetch(); reset(); }
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = Math.floor(Date.now() / 1000);
  const readyAt = last ? Number(last) + 3600 : 0;
  const waiting = last ? now < readyAt : false;
  const mins = waiting ? Math.ceil((readyAt - now) / 60) : 0;
  const busy = isPending || mining;

  return (
    <div className="faucet">
      <div>
        <b>Need something to try it with?</b>
        <p>
          Claim 100 test {symbol}, no permission needed. You'll need testnet ETH for gas —{" "}
          <a href={FAUCET_URL} target="_blank" rel="noreferrer">Robinhood's faucet</a> has it.
        </p>
      </div>
      <button
        className="btn"
        disabled={!isConnected || busy || waiting}
        onClick={() => writeContract({address: token, abi: TOKEN_ABI, functionName: "claim",
                                      chainId: robinhoodTestnet.id})}
      >
        {!isConnected ? "Connect first" : busy ? "Claiming…" : waiting ? `Again in ${mins}m` : `Claim 100 ${symbol}`}
      </button>
    </div>
  );
}

/**
 * Test USDG, so anyone can buy an upside or run the parity demo. The quote asset is a testnet
 * stand-in with an open mint and no value; a cooldown would only make the demo harder to run.
 */
export function UsdgFaucet() {
  const {address, isConnected} = useAccount();
  const {writeContract, data: hash, isPending, reset} = useWriteContract();
  const {isLoading: mining, isSuccess} = useWaitForTransactionReceipt({hash});
  useEffect(() => {
    if (isSuccess) reset();
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = isPending || mining;

  return (
    <div className="faucet">
      <div>
        <b>Need cash to buy with?</b>
        <p>Mint 100,000 test USDG. It is the quote asset every pool here trades against.</p>
      </div>
      <button
        className="btn"
        disabled={!isConnected || busy}
        onClick={() => writeContract({address: ADDRESSES.usdg as `0x${string}`, abi: TOKEN_ABI,
                                      functionName: "mint", args: [address!, 100_000_000_000n],
                                      chainId: robinhoodTestnet.id})}
      >
        {!isConnected ? "Connect first" : busy ? "Minting…" : "Get 100,000 USDG"}
      </button>
    </div>
  );
}
