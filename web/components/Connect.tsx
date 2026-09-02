"use client";

import {useAccount, useConnect, useDisconnect, useSwitchChain} from "wagmi";
import {robinhoodTestnet} from "@/lib/chain";

export function Connect() {
  const {address, isConnected, chainId} = useAccount();
  const {connect, connectors, isPending} = useConnect();
  const {disconnect} = useDisconnect();
  const {switchChain} = useSwitchChain();

  if (!isConnected) {
    const c = connectors[0];
    return (
      <button className="btn primary" disabled={!c || isPending} onClick={() => c && connect({connector: c})}>
        {isPending ? "Connecting…" : c ? "Connect wallet" : "No wallet found"}
      </button>
    );
  }

  if (chainId !== robinhoodTestnet.id) {
    return (
      <button className="btn warn" onClick={() => switchChain({chainId: robinhoodTestnet.id})}>
        Switch to Robinhood testnet
      </button>
    );
  }

  return (
    <button className="btn ghost" onClick={() => disconnect()} title={address}>
      {address?.slice(0, 6)}…{address?.slice(-4)}
    </button>
  );
}
