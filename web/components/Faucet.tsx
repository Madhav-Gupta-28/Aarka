"use client";

import {useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract} from "wagmi";
import {ADDRESSES, TOKEN_ABI} from "@/lib/contracts";
import {FAUCET_URL} from "@/lib/chain";

/**
 * Anyone can mint themselves test NVDA, once an hour, with no permission from us.
 * That is deliberate: the demo has to be runnable by a stranger without asking.
 */
export function Faucet({symbol}: {symbol: string}) {
  const {address, isConnected} = useAccount();
  const {data: last, refetch} = useReadContract({
    address: ADDRESSES.nvda as `0x${string}`, abi: TOKEN_ABI, functionName: "lastClaimed",
    args: address ? [address] : undefined, query: {enabled: !!address},
  });
  const {writeContract, data: hash, isPending, reset} = useWriteContract();
  const {isLoading: mining, isSuccess} = useWaitForTransactionReceipt({hash});
  if (isSuccess) { refetch(); reset(); }

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
        onClick={() => writeContract({address: ADDRESSES.nvda as `0x${string}`,
                                      abi: TOKEN_ABI, functionName: "claim"})}
      >
        {!isConnected ? "Connect first" : busy ? "Claiming…" : waiting ? `Again in ${mins}m` : `Claim 100 ${symbol}`}
      </button>
    </div>
  );
}
