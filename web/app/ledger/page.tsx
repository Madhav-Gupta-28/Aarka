"use client";

import Link from "next/link";
import {useAccount, useConnect} from "wagmi";
import {Shell} from "@/components/Chrome";
import {DigitRoll} from "@/components/Motion";
import {GearAnim, Relic, Reveal} from "@/components/Relic";
import {astroFrac} from "@/components/SplitBits";
import {useCollect} from "@/lib/collect";
import {quoteFor, useParityAll, usePositions, useSeries, valuePosition} from "@/lib/data";
import type {Position, SeriesView} from "@/lib/lens";
import {endCode, endShort, money, n18, n8, nowSec, plural, qty, stockName, lineLabel} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {explorerTx} from "@/lib/tx";
import {spot, usePrefs, useReceipts} from "@/lib/ui";

export default function Ledger() {
  const {address, isConnected} = useAccount();
  const {connect, connectors} = useConnect();
  const {data: series} = useSeries();
  const {data: parity} = useParityAll(series);
  const {data: positions, isLoading} = usePositions();
  const receipts = useReceipts(address);
  const {view} = usePrefs();

  const bySeries = new Map((series ?? []).map((s) => [s.series.toLowerCase(), s]));
  const held = (positions ?? [])
    .filter((p) => p.floorBalance > 0n || p.upsideBalance > 0n)
    .map((p) => ({p, s: bySeries.get(p.series.toLowerCase())}))
    .filter((x): x is {p: Position; s: SeriesView} => !!x.s)
    .map((x) => ({...x, q: quoteFor(x.s, parity)}))
    .map((x) => ({...x, v: valuePosition(x.p, x.s, x.q)}));

  const open = held.filter((x) => x.s.status !== 3);
  const ready = held.filter((x) => x.s.status === 3);
  const openVal = open.reduce((a, x) => a + x.v.today, 0);
  const readyVal = ready.reduce((a, x) => a + x.v.today, 0);
  const fTot = open.reduce((a, x) => a + x.v.floor, 0);
  const uTot = open.reduce((a, x) => a + x.v.upside, 0);
  const total = openVal + readyVal;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  if (!isConnected) {
    return (
      <Shell>
        <section className="wrap centre-page gridlines">
          <div className="plinth"><Relic name="fragTablet" size={320} alt="A broken clay ledger tablet" /></div>
          <div>
            <span className="kicker">F2 · MY LEDGER</span>
            <h1 className="display h-page">Connect to see <span className="px-em">your ledger.</span></h1>
            <p className="lead" style={{maxWidth: 520}}>Your ledger lists every Floor and Upside you hold, what each is worth today, and anything ready to collect. You can look around the rest of Aarka without connecting.</p>
            <div className="row gap-16 wrap-row">
              <button className="btn btn-primary btn-lg" onClick={() => connectors[0] && connect({connector: connectors[0]})}>Connect wallet</button>
              <Link href="/markets" className="btn btn-secondary btn-lg">Browse splits</Link>
            </div>
          </div>
        </section>
      </Shell>
    );
  }

  if (!isLoading && positions && held.length === 0) {
    return (
      <Shell>
        <section className="wrap centre-page gridlines">
          <div className="plinth dither"><Relic name="fragTablet" size={320} alt="A broken clay ledger tablet" /></div>
          <div>
            <span className="kicker">F2 · MY LEDGER</span>
            <h1 className="display h-page">Your ledger is <span className="px-em">empty.</span></h1>
            <p className="lead" style={{maxWidth: 520}}>Start with practice shares. They follow real prices, cost nothing, and everything you do with them is marked PRACTICE.</p>
            <div className="row gap-16 wrap-row">
              <Link href="/practice" className="btn btn-primary btn-lg">Get free practice shares</Link>
              <Link href="/markets" className="btn btn-secondary btn-lg">Browse splits</Link>
            </div>
          </div>
        </section>
        <History receipts={receipts} />
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="gridlines" style={{paddingBlock: "clamp(40px, 5vw, 72px) 64px", borderBottom: "1px solid var(--line)"}}>
        <div className="wrap ledger-top">
          <div>
            <div className="row gap-12 wrap-row"><span className="kicker">F2 · MY LEDGER</span><span className="stamp stamp-practice">PRACTICE MODE</span></div>
            <span className="label" style={{fontSize: 13, letterSpacing: ".12em"}}>EVERYTHING YOU HOLD, WORTH TODAY</span>
            {isLoading ? <div className="skel" style={{height: 110, width: "min(560px, 100%)"}} /> : <DigitRoll text={money(total)} size={128} className="gold" style={{letterSpacing: "-.05em", maxWidth: "100%"}} />}
            <span className="body">Across {open.length} open {plural(open.length, "split")}{ready.length ? <>, plus {money(readyVal)} ready to collect</> : ""}.</span>
          </div>
          <div>
            <span className="label">WHAT IT&apos;S MADE OF</span>
            <div role="img" aria-label={`Floors ${money(fTot)}, Upsides ${money(uTot)}, ready to collect ${money(readyVal)}`} className="mix">
              <span style={{width: `${pct(fTot)}%`, background: "var(--accent)"}} />
              <span style={{width: `${pct(uTot)}%`, borderLeft: "1px solid var(--bg)", background: "repeating-linear-gradient(135deg,var(--accent) 0 1.5px,transparent 1.5px 6px)"}} />
              <span style={{width: `${pct(readyVal)}%`, borderLeft: "1px solid var(--bg)", background: "var(--text)"}} />
            </div>
            <div className="stack gap-10" style={{fontSize: 15}}>
              <div className="row" style={{justifyContent: "space-between"}}><span className="row gap-10"><span style={{width: 14, height: 14, background: "var(--accent)"}} />Floors</span><span className="num">{money(fTot)}</span></div>
              <div className="row" style={{justifyContent: "space-between"}}><span className="row gap-10"><span style={{width: 14, height: 14, border: "1px solid var(--accent)", background: "repeating-linear-gradient(135deg,var(--accent) 0 1px,transparent 1px 4px)"}} />Upsides</span><span className="num">{money(uTot)}</span></div>
              <div className="row" style={{justifyContent: "space-between"}}><span className="row gap-10"><span style={{width: 14, height: 14, background: "var(--text)"}} />Ready to collect</span><span className="num">{money(readyVal)}</span></div>
            </div>
          </div>
        </div>
      </section>

      {ready.length > 0 && (
        <section aria-label="Ready to collect" className="wrap" style={{paddingBlock: 48}}>
          <div className="ready-box">
            <div className="ready-head">
              <span className="stamp stamp-final">READY TO COLLECT</span>
              <h2 className="display" style={{fontSize: "clamp(28px, 3vw, 44px)", lineHeight: 1}}>Your ended splits have paid out</h2>
            </div>
            {ready.map((x) => <ReadyRow key={x.s.series} s={x.s} p={x.p} />)}
            <p className="small" style={{padding: "16px 28px"}}>Your payout waits here as long as you need. There&apos;s no deadline to collect. Each split pays in its own share tokens.</p>
          </div>
        </section>
      )}

      <section className="wrap stack gap-28" style={{paddingBlock: "80px 48px"}}>
        <div className="head12 with-note">
          <div className="kicker">TABLET I</div>
          <h2 className="display h-sub" style={{fontSize: "clamp(40px, 5vw, 72px)"}}>What you hold</h2>
          <p className="note" style={{fontSize: 15}}>&quot;If it ended today&quot; uses today&apos;s price as if it were the final price.</p>
        </div>
        {isLoading && <div className="skel" style={{height: 120}} />}
        {view === "simple" ? (
          <div className="stack gap-16">
            {open.map((x, i) => <HoldRow key={x.s.series} x={x} delay={i * 80} />)}
            {!isLoading && open.length === 0 && <p className="body">Nothing open right now. <Link href="/markets">Browse splits →</Link></p>}
          </div>
        ) : (
          <div className="term-scroll">
            <table className="term-table">
              <thead><tr>{["SPLIT", "F QTY", "U QTY", "F PX", "U PX", "VALUE", "IF END", "DTE"].map((h, i) => <th key={h} className={i ? "r" : ""}><span>{h}</span></th>)}</tr></thead>
              <tbody>
                {open.map((x) => (
                  <tr key={x.s.series}>
                    <td style={{fontWeight: 600}}><Link href={`/split/${x.s.series}`} style={{color: "inherit", textDecoration: "none"}}>{x.s.underlyingSymbol}-{Math.round(x.q.strike)}-{endCode(x.s.expiry)}</Link></td>
                    <td className="r">{qty(n18(x.p.floorBalance))}</td><td className="r">{qty(n18(x.p.upsideBalance))}</td>
                    <td className="r">{x.q.floor.toFixed(2)}</td><td className="r">{x.q.upside.toFixed(2)}</td>
                    <td className="r gold">{x.v.today.toFixed(2)}</td><td className="r">{x.v.ifEnd.toFixed(2)}</td>
                    <td className="r">{x.s.status === 0 ? Math.max(0, Math.ceil((Number(x.s.expiry) - nowSec()) / 86400)) : "ENDED"}</td>
                  </tr>
                ))}
                <tr style={{background: "var(--surface)"}}><td className="muted">TOTAL OPEN</td><td /><td /><td /><td /><td className="r gold">{openVal.toFixed(2)}</td><td className="r">{open.reduce((a, x) => a + x.v.ifEnd, 0).toFixed(2)}</td><td /></tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <History receipts={receipts} />
    </Shell>
  );
}

type Held = {p: Position; s: SeriesView; q: ReturnType<typeof quoteFor>; v: ReturnType<typeof valuePosition>};

function HoldRow({x, delay}: {x: Held; delay: number}) {
  const {p, s, q, v} = x;
  const name = stockName(s.underlyingSymbol);
  const f = n18(p.floorBalance), u = n18(p.upsideBalance);
  const days = Math.max(0, Math.ceil((Number(s.expiry) - nowSec()) / 86400));
  const ifNote = s.status !== 0 ? "Ended. The final price decides this."
    : q.spot <= q.strike ? (u ? `Upsides would pay $0: ${name} is below the line.` : `Each Floor would pay ${money(q.spot)}.`)
      : `Each Upside would pay ${money(q.spot - q.strike)}.`;
  return (
    <Reveal delay={delay}>
      <Link href={s.status === 0 ? `/split/${s.series}` : `/split/${s.series}/final`} className="hold-row spot" {...spot}>
        <Relic name="tablet" size={64} />
        <div className="stack gap-8">
          <strong className="display" style={{fontSize: 30, lineHeight: 1}}>{name} split</strong>
          <span className="label" style={{fontSize: 13}}>${lineLabel(q.strike)} LINE · ENDS {endShort(s.expiry).toUpperCase()}</span>
          <span className="row gap-8 mono" style={{fontSize: 13, color: "var(--text-2)"}}><Relic src={RELIC.astro(astroFrac(s.expiry))} size={24} />{s.status === 0 ? `Ends in ${days} ${plural(days, "day")}` : "Ended"}</span>
        </div>
        <div className="stack gap-8">
          <span className="label">YOU HOLD</span>
          <div className="row gap-14" style={{gap: 14, fontWeight: 500}}>
            <span className="row" style={{gap: 6, opacity: f ? 1 : 0.35}}><Relic name="coinFloor" size={24} />{qty(f)} {plural(f, "Floor")}</span>
            <span className="row" style={{gap: 6, opacity: u ? 1 : 0.35}}><Relic name="coinUp" size={24} />{qty(u)} {plural(u, "Upside")}</span>
          </div>
        </div>
        <div className="stack gap-8"><span className="label">WORTH TODAY</span><span className="num gold" style={{fontSize: 28, lineHeight: 1}}>{money(v.today)}</span><span className="mono muted" style={{fontSize: 12}}>{q.source === "market" ? "POOL PRICES" : "ESTIMATE"}</span></div>
        <div className="stack gap-8"><span className="label">IF IT ENDED TODAY</span><span className="num" style={{fontSize: 22, lineHeight: 1}}>{money(v.ifEnd)}</span><span className="small" style={{fontSize: 14}}>{ifNote}</span></div>
        <span className="btn btn-secondary btn-sm">View</span>
      </Link>
    </Reveal>
  );
}

function ReadyRow({s, p}: {s: SeriesView; p: Position}) {
  const c = useCollect(s, p.floorBalance, p.upsideBalance);
  const name = stockName(s.underlyingSymbol);
  const f = n18(p.floorBalance), u = n18(p.upsideBalance);
  const done = c.phase === "done" && c.step === "idle";
  return (
    <div className="ready-row">
      <Relic name="stele" size={64} />
      <div className="stack gap-6" style={{gap: 6}}><strong className="display" style={{fontSize: 28, lineHeight: 1.05}}>{name} split</strong><span className="label" style={{fontSize: 13}}>${Math.round(n8(s.strike))} LINE · ENDED {endShort(s.expiry).toUpperCase()}</span></div>
      <div className="stack" style={{gap: 6}}>
        <span className="label">FINAL PRICE · THE SUN</span>
        <span className="num" style={{fontSize: 22}}>{money(c.px)}</span>
        <span className="small" style={{fontSize: 14}}>Each Floor pays {money(Math.min(c.px, n8(s.strike)))} · each Upside pays {money(Math.max(c.px - n8(s.strike), 0))}</span>
      </div>
      <div className="stack" style={{gap: 6}}><span className="label">YOU HOLD</span><span style={{fontSize: 16, lineHeight: 1.35}}>{[f ? `${qty(f)} ${plural(f, "Floor")}` : "", u ? `${qty(u)} ${plural(u, "Upside")}` : ""].filter(Boolean).join(" + ")}</span></div>
      {done ? (
        <div className="stack" style={{gap: 6, alignItems: "flex-end"}}><span className="up" style={{fontWeight: 600}}>✓ Collected {money(c.total)}</span>{c.hash && <a href={explorerTx(c.hash)} target="_blank" rel="noreferrer">View receipt ↗</a>}</div>
      ) : (
        <button className="btn btn-primary" disabled={c.busy} onClick={() => c.collect()}>
          {c.busy && <GearAnim size={24} />}{c.busy ? (c.step === "upside" ? "Collecting Upsides…" : "Collecting…") : `Collect ${money(c.total)}`}
        </button>
      )}
    </div>
  );
}

function History({receipts}: {receipts: ReturnType<typeof useReceipts>}) {
  if (!receipts.length) return null;
  const icon = (k: string) => (RELIC as unknown as Record<string, string>)[k] ?? RELIC.tablet;
  return (
    <section className="wrap stack gap-28" style={{paddingBlock: "48px 112px"}}>
      <div className="head12 with-note">
        <div className="kicker">TABLET II</div>
        <h2 className="display h-sub" style={{fontSize: "clamp(40px, 5vw, 72px)"}}>History</h2>
        <p className="note" style={{fontSize: 15}}>Every action you took from this browser, inscribed with a date. Each links to its public receipt.</p>
      </div>
      <div className="history">
        {receipts.map((r, i) => (
          <Reveal key={r.hash} delay={(i % 4) * 60} className="receipt">
            <div className="row" style={{justifyContent: "space-between"}}>
              <span className="label">{new Date(r.at).toLocaleString("en-GB", {day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"}).toUpperCase().replace(",", " ·")}</span>
              <Relic src={icon(r.icon)} size={32} />
            </div>
            <strong className="display" style={{fontSize: 24, lineHeight: 1.1}}>{r.title}</strong>
            <p style={{fontSize: 14, lineHeight: 1.45}}>{r.body}</p>
            <div className="row" style={{justifyContent: "space-between", marginTop: "auto", paddingTop: 10, borderTop: "1px solid #B8AE9A"}}>
              <span className="num" style={{fontSize: 15}}>{r.amount}</span>
              <a href={explorerTx(r.hash)} target="_blank" rel="noreferrer" style={{fontSize: 13}}>Receipt ↗</a>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
