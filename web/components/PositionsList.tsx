"use client";

import Link from "next/link";
import {AnimatePresence, motion} from "motion/react";
import {useState} from "react";
import {useAccount, useConnect} from "wagmi";
import {useCollect} from "@/lib/collect";
import {clearPractice, usePractice, type PracticePos} from "@/lib/practice";
import {quoteFor, useParityAll, usePositions, useSeries, valuePosition} from "@/lib/data";
import type {Position, SeriesView} from "@/lib/lens";
import {countdown, endShort, money, n18, n8, nowSec, plural, qty, stockName} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {shareCard, type Card} from "@/lib/shareCard";
import {play} from "@/lib/sound";
import {explorerTx} from "@/lib/tx";
import {DigitRoll} from "./Motion";
import {GearAnim, Relic} from "./Relic";
import {astroFrac, statusOf} from "./SplitBits";

/**
 * What you hold, as a shelf of coins. One card per split: the halves you hold on the front, with
 * what they're worth and what they'd pay if it ended today; on the back, exactly how they pay and
 * the things you can do. Cards ready to collect glow and sit first.
 */
export function PositionsList() {
  const {isConnected} = useAccount();
  const {connect, connectors} = useConnect();
  const {data: series} = useSeries();
  const {data: parity} = useParityAll(series);
  const {data: positions, isLoading} = usePositions();
  const practice = usePractice();

  const bySeries = new Map((series ?? []).map((s) => [s.series.toLowerCase(), s]));
  const held = (positions ?? [])
    .filter((p) => p.floorBalance > 0n || p.upsideBalance > 0n)
    .map((p) => ({p, s: bySeries.get(p.series.toLowerCase())}))
    .filter((x): x is {p: Position; s: SeriesView} => !!x.s)
    .map((x) => ({...x, q: quoteFor(x.s, parity)}))
    .map((x) => ({...x, v: valuePosition(x.p, x.s, x.q)}))
    .sort((a, b) => (b.s.status === 3 ? 1 : 0) - (a.s.status === 3 ? 1 : 0) || Number(a.s.expiry - b.s.expiry));
  const total = held.reduce((t, x) => t + x.v.today, 0);

  return (
    <section id="positions" className="shelf-sec" aria-label="Your positions">
      <div className="wrap stack gap-24">
        <div className="pos-head">
          <div className="stack gap-8">
            <span className="kicker">YOUR POSITIONS · LIVE</span>
            <h2 className="display h-sub" style={{fontSize: "clamp(36px, 4.4vw, 64px)"}}>What you hold</h2>
          </div>
          {isConnected && held.length > 0 && (
            <div className="stack" style={{alignItems: "flex-end", gap: 6}}>
              <span className="label">WORTH TODAY · {held.length} {plural(held.length, "SPLIT")}</span>
              <DigitRoll text={money(total)} size={48} className="gold" />
            </div>
          )}
        </div>

        {practice.length > 0 && (
          <div className="stack gap-12">
            <div className="row" style={{justifyContent: "space-between", alignItems: "center"}}>
              <span className="label">PRACTICE RUNS · PRETEND, THIS TAB ONLY</span>
              <button className="btn-link mono muted" onClick={clearPractice}>Clear</button>
            </div>
            <ul className="shelf" role="list">
              <AnimatePresence initial={false}>
                {practice.map((x) => (
                  <motion.li key={x.id} layout initial={{opacity: 0, y: 30, scale: 0.9}} animate={{opacity: 1, y: 0, scale: 1}} exit={{opacity: 0, scale: 0.9}} transition={{type: "spring", stiffness: 260, damping: 24}}>
                    <PracticeCard x={x} onReal={() => connectors[0] && connect({connector: connectors[0]})} connected={isConnected} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}

        {!isConnected && practice.length > 0 ? null : !isConnected ? (
          <div className="shelf ghosted">
            {[0, 1, 2].map((i) => <div key={i} className="coin-card ghost" aria-hidden><Relic src={i === 1 ? RELIC.coinUp : RELIC.coinFloor} size={96} /></div>)}
            <div className="shelf-over">
              <p className="body">Connect a wallet and every split you hold sits here: what it&apos;s worth, what it pays, and when.</p>
              <button className="btn btn-secondary" onClick={() => connectors[0] && connect({connector: connectors[0]})}>Connect wallet</button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="shelf">{[0, 1, 2].map((i) => <div key={i} className="coin-card skel" />)}</div>
        ) : held.length === 0 ? (
          <div className="shelf-empty">
            <div className="empty-plinth" aria-hidden><span /></div>
            <p className="body">Your halves will rest here. Choose one above, and it lands on this shelf the moment it&apos;s confirmed.</p>
          </div>
        ) : (
          <ul className="shelf" role="list">
            <AnimatePresence initial={false}>
              {held.map((x, i) => (
                <motion.li key={x.s.series} layout initial={{opacity: 0, y: 24}} animate={{opacity: 1, y: 0, transition: {delay: i * 0.05}}} exit={{opacity: 0, scale: 0.9}}>
                  <CoinCard {...x} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}

function CoinCard({p, s, q, v}: {p: Position; s: SeriesView; q: ReturnType<typeof quoteFor>; v: ReturnType<typeof valuePosition>}) {
  const [flip, setFlip] = useState(false);
  const name = stockName(s.underlyingSymbol);
  const f = n18(p.floorBalance), u = n18(p.upsideBalance);
  const st = statusOf(s);
  const K = n8(s.strike);
  const ready = s.status === 3;
  const soon = s.status === 0 && Number(s.expiry) - nowSec() < 86400;
  const both = f > 0 && u > 0;
  const stamp = ready ? ["READY TO COLLECT", "stamp-final"] : s.status === 0 ? (soon ? ["ENDS WITHIN A DAY", "stamp-delayed"] : ["OPEN", "stamp-live"]) : [st.word.toUpperCase(), "stamp-sun"];

  return (
    <div className={`coin-card${flip ? " flipped" : ""}${ready ? " ready" : ""}`}
         onMouseEnter={() => setFlip(true)} onMouseLeave={() => setFlip(false)}
         onFocus={() => setFlip(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFlip(false); }}>
      <div className="coin-inner">
        {/* Front: what it is, what it's worth. */}
        <div className="coin-face front">
          <div className="row" style={{justifyContent: "space-between", alignItems: "flex-start"}}>
            <span className={`stamp ${stamp[1]}`} style={{fontSize: 10}}>{stamp[0]}</span>
            <span className="astro-ring" title={s.status === 0 ? `${countdown(s.expiry)} left` : "Ended"}><Relic src={RELIC.astro(astroFrac(s.expiry))} size={36} /></span>
          </div>
          <div className="coin-art" aria-hidden>
            {f > 0 && <Relic src={RELIC.coinFloor} size={both ? 72 : 96} />}
            {u > 0 && <Relic src={RELIC.coinUp} size={both ? 72 : 96} style={both ? {marginLeft: -24} : undefined} />}
          </div>
          <strong className="display" style={{fontSize: 24, lineHeight: 1}}>{name} · ${Math.round(K)}</strong>
          <span className="mono muted" style={{fontSize: 12}}>
            {[f ? `${qty(f)} ${plural(f, "Floor")}` : "", u ? `${qty(u)} ${plural(u, "Upside")}` : ""].filter(Boolean).join(" + ")}
            {" · "}{s.status === 0 ? `ends ${endShort(s.expiry)}` : st.word}
          </span>
          <div className="coin-nums">
            <div><span className="label">NOW</span><span className="num gold" style={{fontSize: 22}}>{money(v.today)}</span></div>
            <div><span className="label">{s.settled ? "PAYS" : "IF IT ENDED TODAY"}</span><span className="num" style={{fontSize: 22}}>{money(v.ifEnd)}</span></div>
          </div>
          <button className="coin-flip-btn mono" onClick={() => setFlip(!flip)} aria-label="Turn the card over">TURN OVER ↻</button>
        </div>

        {/* Back: how it pays, and what you can do. */}
        <div className="coin-face back">
          <span className="label">HOW IT PAYS ON {endShort(s.expiry).toUpperCase()}</span>
          {f > 0 && (
            <div className="pays"><Relic src={RELIC.coinFloor} size={28} /><div><b>Each Floor</b><span>{name}&apos;s price, up to ${Math.round(K)}</span><code>min(P, {Math.round(K)})</code></div></div>
          )}
          {u > 0 && (
            <div className="pays"><Relic src={RELIC.coinUp} size={28} /><div><b>Each Upside</b><span>every dollar above ${Math.round(K)}</span><code>max(P − {Math.round(K)}, 0)</code></div></div>
          )}
          <span className="small muted" style={{fontSize: 12}}>Paid in {s.underlyingSymbol} share tokens. Today {name} is {money(q.spot)}.</span>
          <div className="coin-acts">
            {ready ? <Collect s={s} p={p} /> : s.status === 0 ? (
              <Link className="btn btn-primary btn-sm" href={`/split/${s.series}`}>Manage</Link>
            ) : (
              <Link className="btn btn-primary btn-sm" href={`/split/${s.series}/final`}>{s.status === 2 ? "Confirming price" : "Set final price"}</Link>
            )}
            {both && <Link className="btn btn-secondary btn-sm" href={`/split/${s.series}?do=rejoin#act`}>Put back together</Link>}
            <ShareBtn s={s} f={f} u={u} today={v.today} />
          </div>
          <button className="coin-flip-btn mono" onClick={() => setFlip(false)} aria-label="Turn the card back">↺ FRONT</button>
        </div>
      </div>
    </div>
  );
}

/** A practice run on the shelf: what it would have been, and the way to do it for real. */
function PracticeCard({x, onReal, connected}: {x: PracticePos; onReal: () => void; connected: boolean}) {
  const name = stockName(x.sym);
  const floor = x.half === "floor";
  return (
    <div className="coin-card practice">
      <div className="coin-inner">
        <div className="coin-face front">
          <div className="row" style={{justifyContent: "space-between", alignItems: "flex-start"}}>
            <span className="stamp stamp-practice" style={{fontSize: 10}}>PRACTICE</span>
            <span className="mono muted" style={{fontSize: 10}}>ends {endShort(BigInt(x.expiry))}</span>
          </div>
          <div className="coin-art" aria-hidden><Relic src={floor ? RELIC.coinFloor : RELIC.coinUp} size={96} /></div>
          <strong className="display" style={{fontSize: 24, lineHeight: 1}}>{name} · ${Math.round(x.K)}</strong>
          <span className="mono muted" style={{fontSize: 12}}>{qty(x.qty, 3)} {plural(x.qty, floor ? "Floor" : "Upside")}</span>
          <div className="coin-nums">
            <div><span className="label">{floor ? "CASH TAKEN" : "PAID"}</span><span className="num gold" style={{fontSize: 22}}>{money(x.cash)}</span></div>
            <div><span className="label">{floor ? "KEPT" : "PAYS"}</span><span className="num" style={{fontSize: 14, lineHeight: 1.3}}>{floor ? `up to $${Math.round(x.K)} each` : `above $${Math.round(x.K)}`}</span></div>
          </div>
          {!connected && <button className="btn btn-primary btn-sm" onClick={onReal}>Make it real →</button>}
        </div>
      </div>
    </div>
  );
}

/** Post this position: which half, which line, what it's worth. */
function ShareBtn({s, f, u, today}: {s: SeriesView; f: number; u: number; today: number}) {
  const [state, setState] = useState<"" | "busy" | "ok">("");
  const name = stockName(s.underlyingSymbol);
  const K = Math.round(n8(s.strike));
  const half = f && !u ? "floor" : u && !f ? "upside" : "both";
  const what = half === "floor" ? "the Floor" : half === "upside" ? "the Upside" : "both halves";
  const card: Card = {
    kicker: `${name} · $${K} line · ends ${endShort(s.expiry)}`,
    headline: `Holding ${what} of ${name}.`,
    big: money(today),
    sub: half === "upside" ? `every dollar above $${K}, no liquidations` : half === "floor" ? `${name}'s value up to $${K}` : "one share, split in two",
    half,
    post: half === "upside" ? `Holding the Upside on $${s.underlyingSymbol} above $${K}. No margin, no liquidations.` : half === "floor" ? `Holding the Floor on $${s.underlyingSymbol} up to $${K}, and sold the rest for cash.` : `Split $${s.underlyingSymbol} at $${K} into a Floor and an Upside.`,
  };
  return (
    <button className="btn btn-quiet btn-sm" aria-label={`Share your ${name} position`} disabled={state === "busy"}
            onClick={async () => { setState("busy"); await shareCard(card); setState("ok"); setTimeout(() => setState(""), 2400); }}>
      {state === "busy" ? "…" : state === "ok" ? "✓ Shared" : "Share"}
    </button>
  );
}

function Collect({s, p}: {s: SeriesView; p: Position}) {
  const c = useCollect(s, p.floorBalance, p.upsideBalance);
  if (c.phase === "done" && c.step === "idle") {
    return c.hash ? <a className="btn btn-up btn-sm" href={explorerTx(c.hash)} target="_blank" rel="noreferrer">✓ Collected ↗</a> : <span className="up">✓ Collected</span>;
  }
  return (
    <button className="btn btn-primary btn-sm" disabled={c.busy} onClick={async () => { if (await c.collect()) play("chime"); }}>
      {c.busy && <GearAnim size={24} />}{c.busy ? "Collecting…" : `Collect ${money(c.total)}`}
    </button>
  );
}
