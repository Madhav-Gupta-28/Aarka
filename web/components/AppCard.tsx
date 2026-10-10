"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {AnimatePresence, motion} from "motion/react";
import {useAccount, useConnect} from "wagmi";
import {useAction} from "@/lib/actions";
import {PRACTICE, addPractice} from "@/lib/practice";
import {marketFor} from "@/lib/contracts";
import {quoteFor, stocksOf, useBalances, useParityAll, useSeries, type Parity} from "@/lib/data";
import type {SeriesView} from "@/lib/lens";
import {cleanAmount, countdown, endShort, money, n18, n6, nowSec, plural, qty, stockName} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {play} from "@/lib/sound";
import {explorerTx} from "@/lib/tx";
import {useReducedMotion} from "@/lib/ui";
import {ActivityTicker} from "./ActivityTicker";
import {CoinStage, type Half} from "./CoinStage";
import {Rewind} from "./Rewind";
import {Emblem} from "./Emblem";
import {CashFaucet, ShareFaucet} from "./Faucets";
import {LiveInscription} from "./Inscription";
import {Magnetic, Pills} from "./Kinetic";
import {Moment, type Done} from "./Moment";
import {GearAnim, Relic} from "./Relic";
import {Tour, type Step} from "./Tour";
import {PayoffChart, WhatIfTrack, payoff, useWhatIf} from "./WhatIf";

/**
 * The app. The coin on the left is the interface; the ticket on the right says it in words.
 *
 *   1  choose your half   click it on the coin, or the matching button
 *   2  draw the line      drag it along the ruler, pick an end date
 *   3  how much           one number, with quick amounts
 *   →  the receipt        a sentence written as you go, and three endings you can preview
 *   →  one button         the exact thing it will do
 */

type Intent = "earn" | "bet";
const halfOf = (i: Intent): Half => (i === "earn" ? "floor" : "upside");
const intentOf = (h: Half): Intent => (h === "floor" ? "earn" : "bet");

const TOUR: Step[] = [
  {sel: ".cstage-canvas", kicker: "START HERE", title: "Pick a half of the coin.", body: "The bottom half is the Floor: keep it and earn cash today. The top half is the Upside: buy it to bet on a rise. Tap either one."},
  {sel: ".ruler", kicker: "THE LINE", title: "Drag the line.", body: "It's the price where the share splits. The Floor is worth the stock up to it; the Upside is everything above it."},
  {sel: ".inscription-card", kicker: "WHAT YOU GET", title: "Read it before you do it.", body: "This writes itself as you change things. Nothing moves until you press the button and confirm in your wallet. It's all test money."},
];

/** The splits a person can act on right now: open, and with pools to trade against. */
function tradable(rows: SeriesView[] | undefined, parity: Record<string, Parity> | undefined, sym: string) {
  return (rows ?? [])
    .filter((r) => r.underlyingSymbol === sym && r.status === 0 && marketFor(r.series) && parity?.[r.series.toLowerCase()])
    .sort((a, b) => Number(a.expiry - b.expiry) || Number(a.strike - b.strike));
}

export function AppCard() {
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const stocks = stocksOf(rows);
  const reduce = useReducedMotion();
  const [sym, setSym] = useState("NVDA");
  const [intent, setIntent] = useState<Intent>("earn");
  const [expiry, setExpiry] = useState<string | null>(null);
  const [seriesAddr, setSeriesAddr] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");
  const [ending, setEnding] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [chart, setChart] = useState(false);

  const options = useMemo(() => tradable(rows, parity, sym), [rows, parity, sym]);
  const spotNow = options[0]?.priceValid ? Number(options[0].spotPrice) / 1e8 : 0;
  const expiries = useMemo(() => [...new Set(options.map((o) => o.expiry.toString()))], [options]);

  // Default: the nearest end date, and on it the line closest above today's price — the classic
  // covered call, and the most honest bet. Anyone who wants another picks it.
  const exp = expiry && expiries.includes(expiry) ? expiry : expiries[0];
  const onDate = options.filter((o) => o.expiry.toString() === exp);
  const s = onDate.find((o) => o.series === seriesAddr) ?? (() => {
    if (!onDate.length) return undefined;
    const above = onDate.filter((o) => Number(o.strike) / 1e8 >= spotNow);
    return (above.length ? above : onDate).sort((a, b) => Math.abs(Number(a.strike) / 1e8 - spotNow) - Math.abs(Number(b.strike) / 1e8 - spotNow))[0];
  })();
  const q = s ? quoteFor(s, parity) : undefined;
  const {data: bal} = useBalances(s);
  const {isConnected} = useAccount();
  const {connect, connectors} = useConnect();
  // A practice run: the whole flow with pretend balances, nothing sent. For anyone who wants to
  // feel it before connecting a wallet.
  const [practice, setPractice] = useState(false);
  const [sim, setSim] = useState<"" | "wallet" | "mining">("");
  useEffect(() => { if (isConnected) setPractice(false); }, [isConnected]);

  const kind = intent === "earn" ? "splitSell" : "buy";
  const a = useAction({s, q, bal, kind, piece: "upside", amount});

  useEffect(() => { setAmount(intent === "earn" ? "1" : "10"); a.reset(); }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSeriesAddr(null); setExpiry(null); }, [sym]);

  const name = stockName(sym);
  const K = q ? q.strike : 0;
  const n = a.n;
  const spot = q?.spot ?? spotNow;

  // The ruler's scale: wide enough that the lines sit well apart on the coin, with room above
  // for the Upside to mean something.
  const prices = [spot, ...options.map((o) => Number(o.strike) / 1e8)].filter(Boolean);
  const lo = Math.max(0, Math.min(...prices) * 0.68);
  const hi = Math.max(...prices) * 1.42;

  // Three endings: falls, stays, rises.
  const ends = spot ? [
    {p: Math.round(spot * 0.85), t: "If it falls", sub: "15% down"},
    {p: Math.round(spot), t: "If it stays", sub: "where it is"},
    {p: Math.round(spot * 1.3), t: "If it rises", sub: "30% up"},
  ] : [];
  const worthAt = (P: number) => intent === "earn" ? n * payoff(P, K).floor + a.cashOut : a.piecesOut * payoff(P, K).upside;
  const baseAt = (P: number) => intent === "earn" ? n * P : n;
  const shownEnding = ending ?? pinned;

  const noShares = isConnected && bal && intent === "earn" && bal.share === 0n;
  const noCash = isConnected && bal && intent === "bet" && bal.cash === 0n;
  const striking = a.phase === "wallet" || a.phase === "mining" || sim !== "";
  const pErr = !practice ? null : intent === "earn"
    ? (n > PRACTICE.shares ? `Practice runs come with ${PRACTICE.shares} shares.` : null)
    : (n > PRACTICE.cash ? `Practice runs come with ${money(PRACTICE.cash, 0)}.` : null);

  const receipt = !q || !s ? "Reading live prices…" : intent === "earn"
    ? `You keep ${qty(n)} ${plural(n, "Floor")}: ${name} up to ${money(K, 0)} until ${endShort(s.expiry)}. You get ${money(a.cashOut)} in cash today.`
    : `You pay ${money(n)} for ${qty(a.piecesOut, 3)} ${plural(a.piecesOut, "Upside")}. Each pays every dollar ${name} ends above ${money(K, 0)} on ${endShort(s.expiry)}.`;

  // The button says exactly what it will do, once it's the main step.
  const ready = a.connected && !a.cta.disabled && !a.needsApproval;
  const mainLabel = intent === "earn" ? `Split and take ${money(a.cashOut)}` : `Buy ${qty(a.piecesOut, 3)} ${plural(a.piecesOut, "Upside")}`;
  const label = practice
    ? (sim === "wallet" ? "Confirming… (pretend)" : sim === "mining" ? "Striking the coin…" : mainLabel)
    : ready ? mainLabel : a.cta.label;
  const disabled = practice ? (!!sim || n <= 0 || !!pErr || !q) : a.cta.disabled;

  // The moment follows the main step only, never the permission step. Its numbers are taken when
  // the button is pressed, because the quote moves once the trade lands.
  const [done, setDone] = useState<Done | null>(null);
  const [flying, setFlying] = useState<{from: DOMRect; to: DOMRect; half: Half} | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeMoment = useCallback(() => { setDone(null); a.reset(); }, [a.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const moment = (): Omit<Done, "hash"> => {
    const kick = `${name} · $${Math.round(K)} line · ends ${endShort(s!.expiry)}`;
    if (intent === "earn") {
      const cash = money(a.cashOut);
      return {
        half: "floor", big: cash, unit: "in cash, today",
        line: `You kept ${qty(n)} ${plural(n, "Floor")}: ${name}'s value up to ${money(K, 0)} until ${endShort(s!.expiry)}. The cash is in your wallet.`,
        card: {kicker: `Split · ${kick}`, headline: "Kept the Floor. Sold the Upside.", big: cash, sub: `cash today, on ${qty(n)} ${name} ${plural(n, "share")}`, half: "floor",
               post: `Split my $${sym} at the $${Math.round(K)} line. Kept the Floor, took ${cash} in cash today. One share, two halves, no liquidations.`},
      };
    }
    const pcs = qty(a.piecesOut, 3);
    return {
      half: "upside", big: pcs, unit: plural(a.piecesOut, "Upside"),
      line: `For ${money(n)}. Each pays every dollar ${name} ends above ${money(K, 0)} on ${endShort(s!.expiry)}. If it ends at or below, they end at $0.`,
      card: {kicker: `Upside · ${kick}`, headline: `Bet on ${name} above ${money(K, 0)}.`, big: money(n), sub: `for ${pcs} ${plural(a.piecesOut, "Upside")}, no margin, no liquidation`, half: "upside",
             post: `Took the Upside on $${sym} above $${Math.round(K)} for ${money(n)}. Every dollar above the line is mine. No margin, no liquidations.`},
    };
  };

  // The kept half flies from the coin to the shelf, then the moment opens.
  const land = (snap: Omit<Done, "hash">, extra: Partial<Done>) => {
    const from = stageRef.current?.getBoundingClientRect();
    const to = document.getElementById("positions")?.getBoundingClientRect();
    if (from && to && !reduce) {
      setFlying({from, to, half: snap.half});
      setTimeout(() => { setFlying(null); setDone({...snap, ...extra}); }, 900);
    } else setDone({...snap, ...extra});
  };
  const go = async () => {
    if (practice) return goPractice();
    const main = isConnected && !!s && !!q && ready;
    const snap = main ? moment() : null;
    const h = await a.cta.onClick();
    if (snap && h) land(snap, {hash: h});
  };
  const goPractice = async () => {
    if (!s || !q) return;
    const real = moment();
    const snap = {...real, line: real.line.replace("The cash is in your wallet.", "In a real run, the cash lands in your wallet.")};
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    setSim("wallet"); await wait(reduce ? 0 : 800);
    setSim("mining"); await wait(reduce ? 0 : 1300);
    setSim("");
    addPractice({sym, series: s.series, K, expiry: s.expiry.toString(), half: intent === "earn" ? "floor" : "upside",
                 qty: intent === "earn" ? n : a.piecesOut, cash: intent === "earn" ? a.cashOut : n});
    land(snap, {practice: true});
  };
  const makeReal = () => { setDone(null); setPractice(false); if (connectors[0]) connect({connector: connectors[0]}); };

  const quick = intent === "earn" ? ["1", "5", "10"] : ["10", "50", "100"];

  return (
    <section id="app" className="app2" aria-label="Choose your half">
      <div className="app2-grid">
        {/* ── The stage ──────────────────────────────────────────────────────────── */}
        <div className="app2-stage" ref={stageRef}>
          <div className="app2-stage-head">
            <span className="kicker">THE APP · NO SIGN-UP</span>
            <h1 className="display app2-h">Choose your <span className="px-em">half.</span></h1>
            <ActivityTicker rows={rows} />
          </div>
          {options.length && s ? (
            <CoinStage
              lo={lo} hi={hi} spot={spot} name={name}
              strikes={onDate.map((o) => ({id: o.series, price: Number(o.strike) / 1e8}))}
              selected={s.series} onSelect={(id) => { setSeriesAddr(id); a.reset(); }}
              half={halfOf(intent)} onHalf={(h) => setIntent(intentOf(h))}
              ending={shownEnding} striking={striking}
              sym={sym} floorPx={q?.floor} upsidePx={q?.upside}
            />
          ) : (
            <div className="cstage cstage-loading"><div className="skel" style={{width: 260, height: 260, borderRadius: "50%"}} /><span className="label">READING THE CHAIN…</span></div>
          )}
        </div>

        {/* ── The ticket ────────────────────────────────────────────────────────── */}
        <div className="app2-ticket">
          <AnimatePresence>
            {practice && (
              <motion.div className="practice-bar" initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: "auto"}} exit={{opacity: 0, height: 0}}>
                <span className="stamp stamp-practice">PRACTICE RUN</span>
                <span className="small">Pretend {PRACTICE.shares} {name} shares and {money(PRACTICE.cash, 0)}. Nothing is sent.</span>
                <button className="btn-link mono" onClick={() => setPractice(false)}>Exit</button>
              </motion.div>
            )}
          </AnimatePresence>
          <Pills id="stock" value={sym} onChange={setSym}
                 options={(stocks.length ? stocks : [{symbol: "NVDA", spot: 0}, {symbol: "TSLA", spot: 0}]).map((st) => ({
                   value: st.symbol, label: <><Emblem sym={st.symbol} size={14} className="pill-emblem" />{stockName(st.symbol)}</>, sub: st.spot ? money(st.spot) : "…",
                 }))} />

          <div className="t-block">
            <span className="t-label"><i>1</i>I WANT TO</span>
            <div className="intent2" role="radiogroup" aria-label="What do you want to do?">
              {(["earn", "bet"] as const).map((it) => (
                <button key={it} role="radio" aria-checked={intent === it} className="intent2-opt" onClick={() => { setIntent(it); play("clink"); }}>
                  {intent === it && <motion.span layoutId="intent2-ring" className="intent2-bg" transition={{type: "spring", stiffness: 420, damping: 34}} />}
                  <Relic src={it === "earn" ? RELIC.coinFloor : RELIC.coinUp} size={32} />
                  <span className="intent2-txt"><b>{it === "earn" ? "Earn cash on my shares" : "Bet on a rise"}</b><small>{it === "earn" ? "Keep the Floor, sell the Upside" : "Buy the Upside"}</small></span>
                </button>
              ))}
            </div>
          </div>

          <div className="t-block">
            <span className="t-label"><i>2</i>THE LINE · {s ? <b className="gold">{money(K, 0)}</b> : "…"}<span className="muted"> · drag it on the coin</span></span>
            <div className="date-tabs" role="radiogroup" aria-label="End date">
              {expiries.map((e) => {
                const o = options.find((x) => x.expiry.toString() === e)!;
                const on = e === exp;
                return (
                  <button key={e} role="radio" aria-checked={on} className={`date-tab${on ? " on" : ""}`} onClick={() => { setExpiry(e); setSeriesAddr(null); a.reset(); play("tick"); }}>
                    <b>{endShort(o.expiry)}</b><small>{countdown(o.expiry)}</small>
                  </button>
                );
              })}
              {!expiries.length && <div className="skel" style={{height: 52, width: "100%"}} />}
            </div>
          </div>

          <div className="t-block">
            <label htmlFor="app-amt" className="t-label"><i>3</i>{intent === "earn" ? `HOW MANY ${name.toUpperCase()} SHARES` : "HOW MUCH CASH"}</label>
            <div className="field big" data-invalid={!!a.err}>
              {intent === "bet" && <span className="num muted" style={{fontSize: 40, marginRight: 6}}>$</span>}
              <input id="app-amt" inputMode="decimal" value={amount} aria-invalid={!!a.err}
                     onChange={(e) => setAmount(cleanAmount(e.target.value, intent === "bet" ? 2 : 6))} />
            </div>
            <div className="chips">
              {quick.map((v) => <button key={v} className={`chip${amount === v ? " on" : ""}`} onClick={() => setAmount(v)}>{intent === "bet" ? `$${v}` : v}</button>)}
              {a.connected && <button className="chip" onClick={() => setAmount(a.useMax())}>MAX</button>}
              <span className="chips-note">{q ? (intent === "earn" ? `= ${money(q.spot * n)} of ${name}` : `${money(q.upside)} per Upside`) : ""}{practice ? ` · practice: ${intent === "earn" ? `${PRACTICE.shares} shares` : money(PRACTICE.cash, 0)}` : a.connected ? ` · ${intent === "earn" ? `you have ${qty(n18(bal?.share ?? 0n))}` : `cash ${money(n6(bal?.cash ?? 0n))}`}` : ""}</span>
            </div>
            {(pErr ?? (practice ? null : a.err)) && <p role="alert" className="field-err">{pErr ?? a.err}</p>}
            <AnimatePresence>
              {(noShares || noCash) && s && (
                <motion.div className="app-faucet" initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: "auto"}} exit={{opacity: 0, height: 0}}>
                  <p className="small">{noShares ? `No ${name} in this wallet yet. Practice shares are free and follow the real price.` : "No practice cash yet. It's free, and it's all test money."}</p>
                  {noShares ? <ShareFaucet symbol={s.underlyingSymbol} token={s.underlying} spot={q?.spot ?? 0} /> : <CashFaucet />}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* The receipt, written as you go. */}
          <div className="inscription-card">
            <div className="row" style={{justifyContent: "space-between", alignItems: "center"}}>
              <span className="t-label" style={{margin: 0}}>WHAT YOU GET</span>
              <Relic src={intent === "earn" ? RELIC.coinFloor : RELIC.coinUp} size={24} />
            </div>
            <LiveInscription text={receipt} />

            <div className="endings" role="group" aria-label="Three endings">
              {ends.map((e) => {
                const v = worthAt(e.p), base = baseAt(e.p);
                const good = v >= base - 0.005;
                return (
                  <button key={e.p} className={`ending${shownEnding === e.p ? " on" : ""}`} aria-pressed={pinned === e.p}
                          onMouseEnter={() => setEnding(e.p)} onMouseLeave={() => setEnding(null)}
                          onFocus={() => setEnding(e.p)} onBlur={() => setEnding(null)}
                          onClick={() => setPinned(pinned === e.p ? null : e.p)}>
                    <span className="ending-t">{e.t}<small>to {money(e.p, 0)}</small></span>
                    <span className={`ending-v num ${good ? "up" : "down"}`}>{money(v)}</span>
                    <span className="ending-s">{intent === "earn" ? `holding: ${money(base)}` : `paid ${money(base)}`}</span>
                  </button>
                );
              })}
            </div>
            <button className="btn-link mono" style={{alignSelf: "flex-start"}} onClick={() => setChart(!chart)} aria-expanded={chart}>
              {chart ? "Hide every ending ▴" : "See every ending ▾"}
            </button>
            <AnimatePresence>
              {chart && q && <EveryEnding K={K} spot={q.spot} name={name} />}
            </AnimatePresence>
          </div>

          <p className={`note-line ${intent === "bet" ? "risk" : ""}`}>
            {intent === "earn"
              ? "You give up the growth above the line. The Floor still falls if the stock falls."
              : "The Upside can end at $0. Only use money you're comfortable losing."}
          </p>

          <div className="app2-cta">
            <Magnetic className="btn-block-wrap">
              <button className="btn btn-primary btn-xl btn-block" disabled={disabled} onClick={go}>
                {(a.cta.spin || sim) && <GearAnim size={24} />}{!practice && a.phase === "mining" ? "Striking the coin…" : label}
              </button>
            </Magnetic>
            {!isConnected && !practice && (
              <button className="btn btn-secondary btn-lg btn-block try-btn" onClick={() => { setPractice(true); play("clink"); }}>
                Try it first, no wallet →
              </button>
            )}
            <span className="mono muted center" style={{fontSize: 12}}>
              {practice ? "PRACTICE · PRETEND BALANCES · NOTHING IS SENT" : a.phase === "done" && a.hash ? <>DONE · <a href={explorerTx(a.hash)} target="_blank" rel="noreferrer">PUBLIC RECEIPT ↗</a></> : a.txError ?? `${a.steps} · PRICE MAY SHIFT UP TO 0.5%`}
            </span>
          </div>

          {s && (
            <div className="app-more row gap-16 wrap-row">
              <Link href={`/split/${s.series}`} className="mono" style={{fontSize: 13}}>Every detail of this split →</Link>
              {Number(s.expiry) - nowSec() < 86400 && <span className="stamp stamp-delayed">ENDS WITHIN A DAY</span>}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {flying && (
          <motion.img key="fly" src={flying.half === "floor" ? RELIC.coinFloor : RELIC.coinUp} alt="" className="fly-half"
                      initial={{left: flying.from.left + flying.from.width / 2 - 60, top: flying.from.top + flying.from.height / 2 - 60, scale: 1.4, opacity: 1}}
                      animate={{left: flying.to.left + 80, top: Math.min(innerHeight - 140, Math.max(20, flying.to.top + 60)), scale: 0.5, opacity: 0.9}}
                      exit={{opacity: 0}} transition={{duration: 0.85, ease: [0.6, 0, 0.2, 1]}} />
        )}
      </AnimatePresence>
      {s && q && (
        <Rewind feed={stocks.find((x) => x.symbol === sym)?.feed} name={name} intent={intent} n={n} ratio={K / (q.spot || K)} />
      )}
      <Moment done={done} onClose={closeMoment} onReal={makeReal} />
      {!done && s && <Tour steps={TOUR} delay={1400} />}
    </section>
  );
}

/** Every ending, for anyone who wants the whole picture: the payoff chart with a sun to drag. */
function EveryEnding({K, spot, name}: {K: number; spot: number; name: string}) {
  const w = useWhatIf(K, spot);
  const p = payoff(w.price, K);
  return (
    <motion.div className="every-ending" initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: "auto"}} exit={{opacity: 0, height: 0}}>
      <PayoffChart compact strike={K} price={w.price} min={w.min} max={w.max} label="" />
      <WhatIfTrack thin strike={K} spot={spot} name={name} {...w} />
      <span className="small muted">At {money(w.price)}: each Floor pays {money(p.floor)}, each Upside {money(p.upside)}.</span>
    </motion.div>
  );
}
