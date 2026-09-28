"use client";

import Link from "next/link";
import {useAccount, useConnect, useReadContract, useSwitchChain} from "wagmi";
import {Shell} from "@/components/Chrome";
import {GearAnim, Relic, Reveal} from "@/components/Relic";
import {FAUCET_URL, robinhoodTestnet} from "@/lib/chain";
import {ADDRESSES, TOKEN_ABI} from "@/lib/contracts";
import {pickFeatured, stocksOf, useSeries} from "@/lib/data";
import {money, nowSec, stockName} from "@/lib/format";
import {useTx} from "@/lib/tx";
import {spot} from "@/lib/ui";

/**
 * Anyone can mint themselves the test stock a split is written on, once an hour, with no
 * permission from us, and test cash with no limit. The demo has to be runnable by a stranger.
 */
export default function Practice() {
  const {data: rows} = useSeries();
  const stocks = stocksOf(rows);
  const {isConnected, chainId} = useAccount();
  const {connect, connectors} = useConnect();
  const {switchChain} = useSwitchChain();
  const featured = pickFeatured(rows);
  const wrong = isConnected && chainId !== robinhoodTestnet.id;

  return (
    <Shell>
      <section className="wrap centre-page gridlines">
        <div className="plinth dither"><Relic name="tablet" size={288} alt="A clay tablet: your practice ledger" /></div>
        <div>
          <span className="stamp stamp-practice stamp-pop">PRACTICE MODE · FREE SHARES</span>
          <h1 className="display h-page">Get free <span className="px-em">practice</span> shares.</h1>
          <p className="lead" style={{maxWidth: 560}}>Practice shares follow real prices but have no cash value. Split them, sell them, collect them. Everything here runs on a test network, so it is all practice.</p>
          <p className="funds-ok"><span>✓</span>NO REAL MONEY. NOTHING HERE CAN COST YOU ANYTHING.</p>
          {!isConnected && <button className="btn btn-primary btn-lg" onClick={() => connectors[0] && connect({connector: connectors[0]})}>{connectors[0] ? "Connect wallet to start" : "No wallet found"}</button>}
          {wrong && <button className="btn btn-primary btn-lg" onClick={() => switchChain({chainId: robinhoodTestnet.id})}>Switch network</button>}
        </div>
      </section>

      <section className="section rule-top">
        <div className="wrap stack gap-32">
          <div className="head12 with-note">
            <div className="kicker">THREE STEPS</div>
            <h2 className="display h-section" style={{fontSize: "clamp(40px, 5vw, 72px)"}}>Ready in a minute</h2>
            <p className="note" style={{fontSize: 15}}>Each step is a free transaction on the test network. Your wallet will ask you to confirm.</p>
          </div>
          <div className="split-cards">
            <Reveal className="card spot lift tone-lapis split-card" {...spot}>
              <span className="numeral">I</span>
              <h3 className="display h-card">Get test ETH for fees</h3>
              <p className="body">Every action pays a tiny network fee in test ETH. Robinhood Chain&apos;s faucet gives it away.</p>
              <a className="btn btn-secondary" href={FAUCET_URL} target="_blank" rel="noreferrer" style={{marginTop: "auto", alignSelf: "flex-start"}}>Open the faucet ↗</a>
            </Reveal>
            <Reveal className="card spot lift split-card" delay={100} {...spot}>
              <span className="numeral">II</span>
              <h3 className="display h-card">Claim practice shares</h3>
              <p className="body">100 practice shares of a stock, once an hour. They track the real price.</p>
              <div className="stack gap-12" style={{marginTop: "auto"}}>
                {stocks.map((st) => <ShareFaucet key={st.symbol} symbol={st.symbol} token={st.token} spot={st.spot} />)}
                {!rows && <div className="skel" style={{height: 52}} />}
              </div>
            </Reveal>
            <Reveal className="card spot lift tone-up split-card" delay={200} {...spot}>
              <span className="numeral">III</span>
              <h3 className="display h-card">Claim practice cash</h3>
              <p className="body">$100,000 of test cash (USDG), to buy a Floor or an Upside without a share.</p>
              <div style={{marginTop: "auto"}}><CashFaucet /></div>
            </Reveal>
          </div>
          {featured && (
            <div className="row gap-16 wrap-row">
              <Link href={`/split/${featured.series}`} className="btn btn-primary btn-lg">Try the {stockName(featured.underlyingSymbol)} split</Link>
              <Link href="/learn" className="btn btn-quiet btn-lg">How it works</Link>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}

function ShareFaucet({symbol, token, spot: px}: {symbol: string; token: `0x${string}`; spot: number}) {
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

function CashFaucet() {
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
