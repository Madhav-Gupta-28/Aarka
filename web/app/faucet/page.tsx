"use client";

import {useAccount} from "wagmi";
import {useData} from "@/components/DataProvider";
import {Faucet, UsdgFaucet} from "@/components/Faucet";
import {Connect} from "@/components/Connect";
import {ADDRESSES} from "@/lib/contracts";
import {FAUCET_URL, explorer, robinhoodTestnet} from "@/lib/chain";

/**
 * Everything a stranger needs to use this without asking anyone for anything.
 *
 * That is the point of the page: the stock tokens, the quote asset and the gas all have to be
 * self-serve, or the demo only works for people who know us.
 */
export default function FaucetPage() {
  const {isConnected} = useAccount();
  const {series} = useData();

  // One faucet per underlying, not per series — the stock token is shared across strikes.
  const stocks = new Map<string, {symbol: string; token: `0x${string}`}>();
  for (const s of series ?? []) {
    stocks.set(s.underlying.toLowerCase(), {symbol: s.underlyingSymbol, token: s.underlying});
  }

  return (
    <div className="narrow">
      <div className="pageHead">
        <div>
          <span className="eyebrow">Faucet</span>
          <h1>Get something to try it with</h1>
          <p>
            Test stock, test cash and testnet gas. No allowlist and nobody to ask — the stock
            faucets are open to any address, once an hour.
          </p>
        </div>
        <div className="headSide">{!isConnected && <Connect />}</div>
      </div>

      <h3 style={{fontSize: 14, fontWeight: 600, marginBottom: 4}}>1 · Gas</h3>
      <div className="faucet">
        <div>
          <b>Testnet ETH</b>
          <p>Every transaction here needs gas. Robinhood runs the faucet for it.</p>
        </div>
        <a className="btn" href={FAUCET_URL} target="_blank" rel="noreferrer">Open faucet ↗</a>
      </div>

      <h3 style={{fontSize: 14, fontWeight: 600, margin: "26px 0 4px"}}>2 · Stock to split</h3>
      {[...stocks.values()].map((s) => (
        <Faucet key={s.token} symbol={s.symbol} token={s.token} />
      ))}

      <h3 style={{fontSize: 14, fontWeight: 600, margin: "26px 0 4px"}}>3 · Cash to buy with</h3>
      <UsdgFaucet />

      <section className="section">
        <div className="sectionHead">
          <h2>Add the network</h2>
          <span>or let the connect button do it</span>
        </div>
        <div className="addrTable">
          <div className="addrRow"><span>Network</span><a>{robinhoodTestnet.name}</a></div>
          <div className="addrRow"><span>Chain ID</span><a>{robinhoodTestnet.id}</a></div>
          <div className="addrRow"><span>RPC</span><a>{robinhoodTestnet.rpcUrls.default.http[0]}</a></div>
          <div className="addrRow"><span>Currency</span><a>ETH</a></div>
          <div className="addrRow">
            <span>Explorer</span>
            <a href={robinhoodTestnet.blockExplorers.default.url} target="_blank" rel="noreferrer">
              {robinhoodTestnet.blockExplorers.default.url}
            </a>
          </div>
        </div>

        <div className="sectionHead" style={{marginTop: 26}}>
          <h2>Token addresses</h2>
          <span>to import into a wallet</span>
        </div>
        <div className="addrTable">
          {[...stocks.values()].map((s) => (
            <div className="addrRow" key={s.token}>
              <span>{s.symbol}</span>
              <a href={explorer("address", s.token)} target="_blank" rel="noreferrer">{s.token}</a>
            </div>
          ))}
          <div className="addrRow">
            <span>USDG</span>
            <a href={explorer("address", ADDRESSES.usdg)} target="_blank" rel="noreferrer">
              {ADDRESSES.usdg}
            </a>
          </div>
        </div>
        <p className="hint">
          The half tokens have one address per series — each market page lists its own under the
          floor and upside symbols.
        </p>
      </section>
    </div>
  );
}
