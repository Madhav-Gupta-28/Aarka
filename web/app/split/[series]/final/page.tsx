"use client";

import Link from "next/link";
import {useParams} from "next/navigation";
import {useEffect, useState} from "react";
import {useAccount} from "wagmi";
import {BackButton} from "@/components/BackButton";
import {Mark} from "@/components/Mark";
import {Countdown, SunRise} from "@/components/Motion";
import {GearAnim, Relic} from "@/components/Relic";
import {SplitMissing} from "@/components/SplitBits";
import {useCollect} from "@/lib/collect";
import {SERIES_ABI} from "@/lib/contracts";
import {quoteFor, useBalances, useOneSeries, useParityAll, useSeries} from "@/lib/data";
import {endLong, endShort, endTime, money, n18, n8, plural, qty, stockName, lineLabel} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {findSettlementRound, type Candidate} from "@/lib/settle";
import {explorerTx, useTx} from "@/lib/tx";

export default function FinalPrice() {
  const {series} = useParams<{series: string}>();
  const {s, isLoading} = useOneSeries(series);
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const {data: bal} = useBalances(s);
  const {isConnected} = useAccount();
  const c = useCollect(s, bal?.floor ?? 0n, bal?.upside ?? 0n);
  const [collected, setCollected] = useState<{total: number; floor: number; upside: number; at: Date} | null>(null);

  if (!s) return <div className="page"><SplitMissing loading={isLoading} /></div>;

  const q = quoteFor(s, parity);
  const name = stockName(s.underlyingSymbol);
  const K = n8(s.strike);
  const f = n18(bal?.floor ?? 0n), u = n18(bal?.upside ?? 0n);
  const holds = [f ? `${qty(f)} ${plural(f, "Floor")}` : "", u ? `${qty(u)} ${plural(u, "Upside")}` : ""].filter(Boolean).join(" and ");
  const phase = collected ? "done" : s.status === 0 ? "before" : s.status === 1 ? "waiting" : s.status === 2 ? "confirming" : "set";
  const badge = {before: ["ENDS " + endShort(s.expiry).toUpperCase(), "stamp-ended"], waiting: ["SETTING THE PRICE", "stamp-sun"], confirming: ["FINAL PRICE SET", "stamp-final"], set: [holds ? "READY TO COLLECT" : "FINAL PRICE SET", "stamp-final"], done: ["COLLECTED", "stamp-live"]}[phase];

  async function collect() {
    const snap = {total: c.total, floor: c.floorUsd, upside: c.upsideUsd};
    if (await c.collect()) setCollected({...snap, at: new Date()});
  }

  return (
    <div className="page">
      <header className="flow-head">
        <Link href="/" aria-label="Aarka home"><Mark size={32} /></Link>
        <span className="label ctx" style={{fontSize: 13, letterSpacing: ".08em"}}>
          <Link href="/app#positions" style={{color: "inherit", textDecoration: "none"}}>WHAT I HOLD</Link> / <span style={{color: "var(--text)"}}>{name.toUpperCase()} SPLIT · ${Math.round(K)} LINE · ENDS {endShort(s.expiry).toUpperCase()}</span>
        </span>
        <span className={`stamp ${badge[1]} ml-auto`}>{badge[0]}</span>
        <BackButton />
      </header>

      <main style={{flex: 1}}>
        {phase === "before" && (
          <section className="wrap section gridlines fp-before">
            <div className="plinth dither"><Relic src={RELIC.astro(0.35)} size={384} alt="Astrolabe dial: time until the end date" style={{maxWidth: "100%", height: "auto"}} /></div>
            <div>
              <span className="kicker">BEFORE THE END</span>
              <h1 className="display h-page">On {endShort(s.expiry)}, The Sun sets the <span className="px-em">final price.</span></h1>
              <div className="stack gap-8"><span className="label" style={{fontSize: 13}}>ENDS IN</span><Countdown to={s.expiry} size={72} /></div>
              <p className="lead" style={{maxWidth: 560, fontSize: 18}}>
                {holds ? `You hold ${holds}. ` : ""}Until then you can keep them, sell either one, or put them back together. You don&apos;t need to do anything on the day itself. The end time is {endTime(s.expiry)}.
              </p>
              <div className="card-flat" style={{display: "grid", gridTemplateColumns: "1fr 1fr", maxWidth: 560}}>
                <div className="stack gap-8" style={{padding: 18, borderRight: "1px solid var(--line)"}}>
                  <span className="label">IF IT ENDED TODAY · {money(q.spot)}</span>
                  <span className="num gold" style={{fontSize: 28}}>{money(Math.min(q.spot, K) + Math.max(q.spot - K, 0))}</span>
                  <span className="small" style={{fontSize: 14}}>Floor {money(Math.min(q.spot, K))} · Upside {money(Math.max(q.spot - K, 0))}</span>
                </div>
                <div className="stack gap-8" style={{padding: 18}}>
                  <span className="label">WORTH TODAY</span>
                  <span className="num" style={{fontSize: 28}}>{money(q.floor + q.upside)}</span>
                  <span className="small" style={{fontSize: 14}}>Floor {money(q.floor)} · Upside {money(q.upside)}</span>
                </div>
              </div>
              <div className="row gap-16 wrap-row"><Link href={`/split/${s.series}?do=sell#act`} className="btn btn-secondary btn-lg">Sell a piece</Link><Link href={`/split/${s.series}?do=rejoin#act`} className="btn btn-quiet btn-lg">Put back together</Link></div>
            </div>
          </section>
        )}

        {phase === "waiting" && <Waiting s={s} name={name} />}

        {(phase === "confirming" || phase === "set") && (
          <section className="wrap section fp-set">
            <div><Stele s={s} name={name} /></div>
            <div>
              <span className={`stamp ${phase === "set" ? "stamp-final" : "stamp-sun"} stamp-pop`} style={{alignSelf: "flex-start"}}>{phase === "set" ? "FINAL PRICE SET" : "CONFIRMING · ANYONE MAY STILL CORRECT IT"}</span>
              <h1 className="display h-page" style={{fontSize: "clamp(48px, 6.1vw, 88px)"}}>{name} ended <span className="px-em">{c.px > K ? "above" : c.px < K ? "below" : "at"}</span> the line.</h1>
              <div className="card-flat" style={{display: "grid", gridTemplateColumns: "1fr 1fr"}}>
                <div className="stack gap-10" style={{padding: 22, borderRight: "1px solid var(--line)"}}>
                  <span className="row gap-10 mono" style={{fontSize: 13, letterSpacing: ".08em"}}><Relic name="coinFloor" size={32} />EACH FLOOR PAYS</span>
                  <span className="num gold" style={{fontSize: 44, lineHeight: 1}}>{money(Math.min(c.px, K))}</span>
                  <span className="small">{c.px >= K ? "The full line, because " + name + " ended above it." : "The whole share's value, because it ended below the line."}</span>
                </div>
                <div className="stack gap-10" style={{padding: 22}}>
                  <span className="row gap-10 mono" style={{fontSize: 13, letterSpacing: ".08em"}}><Relic name="coinUp" size={32} />EACH UPSIDE PAYS</span>
                  <span className="num gold" style={{fontSize: 44, lineHeight: 1}}>{money(Math.max(c.px - K, 0))}</span>
                  <span className="small">{c.px > K ? `${money(c.px)} minus the $${lineLabel(K)} line.` : "Nothing, because nothing ended above the line."}</span>
                </div>
              </div>
              {phase === "confirming" ? (
                <p className="lead" style={{fontSize: 18}}>For one hour after the price is carved, anyone may replace it with a strictly later round the rules allow. Collecting opens in about <strong style={{color: "var(--text)"}}>{c.unlockMin} min</strong>. Putting pairs back together works throughout.</p>
              ) : (
                <p className="lead" style={{fontSize: 18}}>
                  {holds ? <>You hold {holds}, so you get <strong style={{color: "var(--text)"}}>{money(c.total)}</strong>, paid in {s.underlyingSymbol} share tokens ({qty(c.floorTokens + c.upsideTokens, 4)}). There&apos;s no deadline to collect.</> : isConnected ? "You don't hold any pieces of this split." : "Connect your wallet to see what you can collect."}
                </p>
              )}
              {phase === "set" && holds && (
                <button className="btn btn-primary" style={{alignSelf: "flex-start", height: 72, padding: "0 40px", fontSize: 22}} disabled={c.busy} onClick={collect}>
                  {c.busy && <GearAnim size={24} />}{c.busy ? (c.txCount > 1 ? `Collecting ${c.step === "upside" ? "Upsides" : "Floors"}…` : "Collecting…") : `Collect ${money(c.total)}`}
                </button>
              )}
              {c.error && <p role="alert" className="note-line risk">{c.error}</p>}
              <span className="label">NETWORK FEE · A LITTLE TESTNET ETH · PAID TO YOUR WALLET{c.txCount > 1 ? " · TWO CONFIRMATIONS" : ""}</span>
            </div>
          </section>
        )}

        {phase === "done" && collected && (
          <section className="wrap section g12" style={{alignItems: "start"}}>
            <div className="receipt stack" style={{gridColumn: "1 / span 8", padding: "clamp(28px, 3.9vw, 56px)", gap: 22}}>
              <div className="row" style={{justifyContent: "space-between"}}><span className="label" style={{letterSpacing: ".14em"}}>RECEIPT · INSCRIBED {collected.at.toLocaleString("en-GB", {day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"}).toUpperCase().replace(",", " ·")}</span><Relic name="stele" size={64} /></div>
              <h1 className="display" style={{fontSize: "clamp(44px, 5.6vw, 80px)", lineHeight: 1, animation: "carve 900ms var(--ease) both"}}>You collected {money(collected.total)}.</h1>
              <p style={{fontSize: 18, lineHeight: 1.55}}>Your {name} split ended at {money(c.px)}. Your Floors paid {money(collected.floor)} and your Upsides paid {money(collected.upside)}, in {s.underlyingSymbol} share tokens. They&apos;re in your wallet.</p>
              <div className="rule" style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr"}}>
                <div className="stack" style={{padding: "14px 0", gap: 6}}><span className="label">FLOOR</span><span className="num" style={{fontSize: 20}}>{money(collected.floor)}</span></div>
                <div className="stack" style={{padding: "14px 0", gap: 6}}><span className="label">UPSIDE</span><span className="num" style={{fontSize: 20}}>{money(collected.upside)}</span></div>
                <div className="stack" style={{padding: "14px 0", gap: 6}}><span className="label">NETWORK FEE</span><span className="num" style={{fontSize: 20}}>TESTNET ETH</span></div>
              </div>
              {c.hash && <a href={explorerTx(c.hash)} target="_blank" rel="noreferrer">View public receipt ↗</a>}
            </div>
            <div className="stack gap-16" style={{gridColumn: "10 / span 3", paddingTop: 24}}>
              <span className="label">WHAT NEXT</span>
              <Link href="/app" className="btn btn-primary btn-lg">Find a new split</Link>
              <Link href="/app#positions" className="btn btn-secondary btn-lg">What I hold</Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Stele({s, name}: {s: {settlementPrice: bigint; expiry: bigint}; name: string}) {
  return (
    <div role="img" aria-label={`Stone stele inscribed: ${name} closed at ${money(n8(s.settlementPrice))} on ${endLong(s.expiry)}`} className="stele-big">
      <Relic name="sunSmall" size={64} />
      <span className="mono" style={{fontSize: 13, letterSpacing: ".2em", color: "#A9A49A", textShadow: "0 1px 0 #2F343D"}}>{endShort(s.expiry).toUpperCase()} · {new Date(Number(s.expiry) * 1000).getFullYear()} · SET BY THE SUN</span>
      <span className="display" style={{fontSize: 44, lineHeight: 1, color: "#D8D3C8", textShadow: "0 -1px 0 #05070A, 0 1px 0 #3A3F48"}}>{name} closed at</span>
      <span className="carved" style={{fontSize: "clamp(56px, 7.2vw, 104px)", lineHeight: 1}}>{money(n8(s.settlementPrice))}</span>
      <div className="divider" style={{width: "100%", margin: 0}} aria-hidden />
      <span style={{fontSize: 17, lineHeight: 1.5}}>Written in stone. It cannot change.</span>
    </div>
  );
}

/**
 * The end date has passed and nobody has asked The Sun for the price yet. Settling is open to
 * anyone: the contract proves the named round is the last one at or before the end, so the result
 * is the same whoever sends it.
 */
function Waiting({s, name}: {s: {series: `0x${string}`; feed: `0x${string}`; expiry: bigint}; name: string}) {
  const [cand, setCand] = useState<Candidate | null | "searching">("searching");
  const tx = useTx();
  const {isConnected} = useAccount();
  useEffect(() => {
    findSettlementRound(s.feed, s.expiry).then(setCand).catch(() => setCand(null));
  }, [s.feed, s.expiry]);

  return (
    <section className="wrap section stack center" style={{alignItems: "center", gap: 32}}>
      <div className="horizon dither"><SunRise size={192} height={300} /></div>
      <span className="mono lapis" style={{fontSize: 14, letterSpacing: ".14em"}}>{endLong(s.expiry).toUpperCase()} · THE SUN IS SETTING THE PRICE</span>
      <h1 className="display h-page" style={{maxWidth: 1000}}>The final price is <span className="px-em">being set.</span></h1>
      <p className="lead" style={{maxWidth: 640, fontSize: 19}}>
        Your money stays exactly where it is while you wait. You can still put your halves back together at any time.
        {cand && cand !== "searching" ? <> The Sun&apos;s price is ready: <strong className="gold">{money(n8(cand.price))}</strong>. Anyone can carve it, and the result is the same whoever does.</> : null}
        {cand === null ? <> The Sun hasn&apos;t published a price the rules accept yet. If it stays quiet, any earlier price is accepted a week after the end date, so this split always settles.</> : null}
      </p>
      <div className="row gap-16 wrap-row" style={{justifyContent: "center"}}>
        {cand && cand !== "searching" && (
          <button className="btn btn-primary btn-lg" disabled={!isConnected || tx.busy}
                  onClick={() => tx.run({address: s.series, abi: SERIES_ABI, functionName: "settle", args: [cand.roundId]}, {toast: "The final price is carved", body: `${name} closed at ${money(n8(cand.price))}.`})}>
            {tx.busy && <GearAnim size={24} />}{!isConnected ? "Connect to carve the price" : tx.busy ? "Carving…" : "Carve the final price"}
          </button>
        )}
        <Link href={`/split/${s.series}?do=rejoin#act`} className="btn btn-secondary btn-lg">Put back together instead</Link>
      </div>
      {cand === "searching" && <span className="label">LOOKING FOR THE ROUND THE RULES ACCEPT…</span>}
      {tx.error && <p role="alert" className="note-line risk">{tx.error}</p>}
    </section>
  );
}
