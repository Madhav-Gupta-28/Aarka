import Link from "next/link";
import {ADDRESSES} from "@/lib/contracts";
import {explorer} from "@/lib/chain";

export function Footer() {
  return (
    <footer className="foot">
      <div className="footInner">
        <p>
          Robinhood Chain testnet. The stock tokens are stand-ins, because testnet carries none;
          their price feeds mirror the real Chainlink prices from mainnet. Everything else — the
          vault, the settlement rules, the parity hook, the router — is the protocol itself.
        </p>
        <div className="footLinks">
          <Link href="/docs">How it works</Link>
          <a href={explorer("address", ADDRESSES.factory)} target="_blank" rel="noreferrer">Factory</a>
          <a href={explorer("address", ADDRESSES.router)} target="_blank" rel="noreferrer">Router</a>
          <a href={explorer("address", ADDRESSES.lens)} target="_blank" rel="noreferrer">Lens</a>
        </div>
      </div>
    </footer>
  );
}
