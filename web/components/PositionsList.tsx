"use client";

import Link from "next/link";
import {AnimatePresence, motion} from "motion/react";
import {useState} from "react";
import {useAccount, useConnect} from "wagmi";
import {useCollect} from "@/lib/collect";
import {quoteFor, useParityAll, usePositions, useSeries, valuePosition} from "@/lib/data";
import type {Position, SeriesView} from "@/lib/lens";
import {countdown, endShort, money, n18, n8, plural, qty, stockName, lineLabel} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {shareCard, type Card} from "@/lib/shareCard";
import {explorerTx} from "@/lib/tx";
import {spot} from "@/lib/ui";
import {DigitRoll} from "./Motion";
import {GearAnim, Relic} from "./Relic";
import {astroFrac, statusOf} from "./SplitBits";

/** Everything this wallet holds, one row per split, and the one thing to do next on each. */
export function PositionsList() {
  const {isConnected} = useAccount();
  const {connect, connectors} = useConnect();
  const {data: series} = useSeries();
  const {data: parity} = useParityAll(series);
  const {data: positions, isLoading} = usePositions();

  const bySeries = new Map((series ?? []).map((s) => [s.series.toLowerCase(), s]));
  const held = (positions ?? [])
    .filter((p) => p.floorBalance > 0n || p.upsideBalance > 0n)
    .map((p) => ({p, s: bySeries.get(p.series.toLowerCase())}))
    .filter((x): x is {p: Position; s: SeriesView} => !!x.s)
    .map((x) => ({...x, q: quoteFor(x.s, parity)}))
    .map((x) => ({...x, v: valuePosition(x.p, x.s, x.q)}))
    // What needs doing first: ready to collect, then soonest to end.
    .sort((a, b) => (b.s.status === 3 ? 1 : 0) - (a.s.status === 3 ? 1 : 0) || Number(a.s.expiry - b.s.expiry));
  const total = held.reduce((t, x) => t + x.v.today, 0);

  return (
    <section id="positions" className="section-tight rule-top" aria-label="Your positions">
      <div className="wrap stack gap-24">
        <div className="pos-head">
          <div className="stack gap-8">
            <span className="kicker">YOUR POSITIONS · LIVE</span>
            <h2 className="display h-sub" style={{fontSize: "clamp(36px, 4.4vw, 64px)"}}>What you hold</h2>
          </div>
          {isConnected && held.length > 0 && (
            <div className="stack gap-6" style={{alignItems: "flex-end", gap: 6}}>
              <span className="label">WORTH TODAY</span>
              <DigitRoll text={money(total)} size={48} className="gold" />
            </div>
          )}
        </div>

        {!isConnected ? (
          <div className="pos-empty dither">
            <Relic name="fragTablet" size={96} />
            <div className="stack gap-12" style={{alignItems: "flex-start"}}>
              <p className="body">Connect a wallet and every split you hold shows up here: what it&apos;s worth, what it pays, and when.</p>
              <button className="btn btn-secondary" onClick={() => connectors[0] && connect({connector: connectors[0]})}>Connect wallet</button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="skel" style={{height: 96}} />
        ) : held.length === 0 ? (
          <div className="pos-empty dither">
            <Relic name="fragTablet" size={96} />
            <p className="body">Nothing yet. Pick a half above, and it lands here the moment it&apos;s confirmed.</p>
          </div>
        ) : (
          <ul className="pos-list">
            <AnimatePresence initial={false}>
              {held.map((x) => (
                <motion.li key={x.s.series} layout initial={{opacity: 0, y: 16}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, x: -40}}>
                  <Row {...x} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}

function Row({p, s, v}: {p: Position; s: SeriesView; v: ReturnType<typeof valuePosition>}) {
  const name = stockName(s.underlyingSymbol);
  const f = n18(p.floorBalance), u = n18(p.upsideBalance);
  const st = statusOf(s);
  const K = n8(s.strike);
  const holds = [f ? `${qty(f)} ${plural(f, "Floor")}` : "", u ? `${qty(u)} ${plural(u, "Upside")}` : ""].filter(Boolean).join(" + ");

  return (
    <div className="pos-row spot" {...spot}>
      <Relic src={RELIC.astro(astroFrac(s.expiry))} size={48} />
      <div className="stack" style={{gap: 6, minWidth: 0}}>
        <strong className="display" style={{fontSize: 24, lineHeight: 1}}>{name} · ${lineLabel(K)}</strong>
        <span className="mono muted" style={{fontSize: 12}}>{holds} · {s.status === 0 ? `ends ${endShort(s.expiry)} · ${countdown(s.expiry)}` : st.word}</span>
      </div>
      <div className="stack pos-num" style={{gap: 4}}>
        <span className="label">NOW</span>
        <span className="num gold" style={{fontSize: 22}}>{money(v.today)}</span>
      </div>
      <div className="stack pos-num" style={{gap: 4}}>
        <span className="label">{s.settled ? "PAYS" : "IF IT ENDED TODAY"}</span>
        <span className="num" style={{fontSize: 22}}>{money(v.ifEnd)}</span>
      </div>
      <div className="pos-act">
        <ShareRow s={s} f={f} u={u} today={v.today} />
        {s.status === 3 ? <Collect s={s} p={p} /> : s.status === 0 ? (
          <Link className="btn btn-secondary btn-sm" href={`/split/${s.series}`}>Manage</Link>
        ) : (
          <Link className="btn btn-secondary btn-sm" href={`/split/${s.series}/final`}>{s.status === 2 ? "Confirming price" : "Set final price"}</Link>
        )}
      </div>
    </div>
  );
}

/** Post this position: which half, which line, what it's worth. */
function ShareRow({s, f, u, today}: {s: SeriesView; f: number; u: number; today: number}) {
  const [state, setState] = useState<"" | "busy" | "ok">("");
  const name = stockName(s.underlyingSymbol);
  const K = lineLabel(n8(s.strike));
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
      {state === "busy" ? "…" : state === "ok" ? "✓" : "Share"}
    </button>
  );
}

function Collect({s, p}: {s: SeriesView; p: Position}) {
  const c = useCollect(s, p.floorBalance, p.upsideBalance);
  if (c.phase === "done" && c.step === "idle") {
    return c.hash ? <a className="btn btn-up btn-sm" href={explorerTx(c.hash)} target="_blank" rel="noreferrer">✓ Collected ↗</a> : <span className="up">✓ Collected</span>;
  }
  return (
    <button className="btn btn-primary btn-sm" disabled={c.busy} onClick={() => c.collect()}>
      {c.busy && <GearAnim size={24} />}{c.busy ? "Collecting…" : `Collect ${money(c.total)}`}
    </button>
  );
}
