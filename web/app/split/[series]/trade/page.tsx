"use client";

import Link from "next/link";
import {useParams} from "next/navigation";
import {useState} from "react";
import {PieceSwitch} from "@/components/ActionPanel";
import {Mark} from "@/components/Mark";
import {GearAnim, Relic} from "@/components/Relic";
import {SplitMissing} from "@/components/SplitBits";
import {FEE_TEXT, useAction, type Piece} from "@/lib/actions";
import {quoteFor, useBalances, useOneSeries, useParityAll, useSeries} from "@/lib/data";
import {cleanAmount, endShort, money, plural, qty, stockName} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {explorerTx} from "@/lib/tx";
import {spot} from "@/lib/ui";

type Mode = "sellUp" | "sellFl" | "buy";

export default function Trade() {
  const {series} = useParams<{series: string}>();
  const {s, isLoading} = useOneSeries(series);
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const {data: bal} = useBalances(s);
  const q = s ? quoteFor(s, parity) : undefined;
  const [mode, setMode] = useState<Mode>("sellUp");
  const [piece, setPiece] = useState<Piece>("upside");
  const [amount, setAmount] = useState("1");
  const [result, setResult] = useState<{title: string; body: string} | null>(null);
  const kind = mode === "buy" ? "buy" : "splitSell";
  const sold: Piece = mode === "sellFl" ? "floor" : "upside";
  const a = useAction({s, q, bal, kind, piece: mode === "buy" ? piece : sold, amount});

  if (!s || !q) return <div className="page"><SplitMissing loading={isLoading} /></div>;

  const name = stockName(s.underlyingSymbol);
  const K = Math.round(q.strike);
  const n = a.n;

  const modes: {k: Mode; title: string; sub: string; i1: string; i2: string; o1: number; o2: number; main?: boolean}[] = [
    {k: "sellUp", title: "Keep the Floor, sell the Upside", sub: `Get cash today for growth above $${K} you don’t expect.`, i1: RELIC.coinFloor, i2: RELIC.coinUp, o1: 1, o2: 0.4, main: true},
    {k: "sellFl", title: "Keep the Upside, sell the Floor", sub: `Get most of the share’s value in cash and keep only the part above $${K}.`, i1: RELIC.coinFloor, i2: RELIC.coinUp, o1: 0.4, o2: 1},
    {k: "buy", title: "Buy a Floor or Upside with cash", sub: "No share needed. Pay cash for just the piece you want.", i1: RELIC.cash, i2: piece === "upside" ? RELIC.coinUp : RELIC.coinFloor, o1: 1, o2: 1},
  ];

  const risk = mode === "sellUp" ? {t: `If ${name} ends above $${K}, the extra growth goes to whoever holds the Upside. Your Floor still moves with ${name} up to $${K}.`, c: "risk"}
    : mode === "sellFl" ? {t: `The Upside you keep can end at $0 if ${name} ends at or below $${K}. Only keep what you’re comfortable losing.`, c: "risk"}
      : piece === "upside" ? {t: "The Upside can end at $0. Only use money you’re comfortable losing.", c: "risk"}
        : {t: `The Floor’s value stops at $${K}, and it still falls if ${name} falls.`, c: ""};

  const title = mode === "buy" ? (piece === "upside" ? "Buy an Upside with cash" : "Buy a Floor with cash") : modes.find((m) => m.k === mode)!.title;
  const lines = mode === "buy"
    ? [["Price per " + (piece === "upside" ? "Upside" : "Floor"), money(a.piecePx), true], ["You pay", money(n), true], ["You get", `about ${qty(a.piecesOut, 3)} ${plural(a.piecesOut, piece === "upside" ? "Upside" : "Floor")}`, false, true], ["Network fee", FEE_TEXT.replace("Network fee: ", ""), false]]
    : [["Price per " + (sold === "upside" ? "Upside" : "Floor"), money(sold === "upside" ? q.upside : q.floor), true], ["You give", `${qty(n)} ${name} ${plural(n, "share")}`, false], ["You receive", `${money(a.cashOut)} cash`, true, true],
       ["You’ll hold after", `${qty(n)} ${plural(n, a.keptName)} · worth ${money((sold === "upside" ? q.floor : q.upside) * n)}`, false], ["Network fee", FEE_TEXT.replace("Network fee: ", ""), false]];

  async function submit() {
    const before = {cash: a.cashOut, pieces: a.piecesOut, n, kept: a.keptName};
    const wasPermission = a.needsApproval;
    const h = await a.cta.onClick();
    if (h && !wasPermission) {
      setResult(mode === "buy"
        ? {title: `You bought about ${qty(before.pieces, 3)} ${plural(before.pieces, piece === "upside" ? "Upside" : "Floor")}.`, body: piece === "upside" ? `It pays everything ${name} ends above $${K} on ${endShort(s!.expiry)}.` : `It pays ${name}’s value up to $${K} on ${endShort(s!.expiry)}.`}
        : {title: `You got about ${money(before.cash)} in cash.`, body: `You still hold ${qty(before.n)} ${plural(before.n, before.kept)} from the ${name} $${K} split.`});
    }
  }

  const stateLabel = result ? "DONE" : a.busy ? "CONFIRMING" : "ORDER";

  return (
    <div className="page">
      <header className="flow-head">
        <Link href="/" aria-label="Aarka home"><Mark size={32} /></Link>
        <span className="label ctx" style={{fontSize: 13, letterSpacing: ".08em"}}>
          <Link href="/markets" style={{color: "inherit", textDecoration: "none"}}>MARKETS</Link> / {name.toUpperCase()} / <Link href={`/split/${s.series}`} style={{color: "inherit", textDecoration: "none"}}>${K} LINE · ENDS {endShort(s.expiry).toUpperCase()}</Link> / <span style={{color: "var(--text)"}}>BUY &amp; SELL</span>
        </span>
        <span className="stamp stamp-practice">PRACTICE MODE</span>
        <span className="ml-auto row gap-10 mono" style={{fontSize: 14}}><Relic name="sunSmall" size={24} />{s.underlyingSymbol} <span className="gold">{money(q.spot)}</span></span>
        <Link href={`/split/${s.series}`} className="btn btn-secondary btn-sm">Exit</Link>
      </header>

      <main className="wrap gridlines flow-body trade" style={{flex: 1}}>
        <div className="main">
          <span className="kicker">F1 · BUY &amp; SELL · {stateLabel}</span>
          <h1 className="display h-page">What would you like to <span className="px-em">do?</span></h1>
          <div role="radiogroup" aria-label="Trade type" className="modes">
            {modes.map((m) => (
              <button key={m.k} role="radio" aria-checked={mode === m.k} className="mode" onClick={() => { setMode(m.k); setAmount(m.k === "buy" ? "100" : "1"); setResult(null); a.reset(); }}>
                <span className="row gap-4"><Relic src={m.i1} size={40} style={{opacity: m.o1}} /><Relic src={m.i2} size={40} style={{opacity: m.o2}} /></span>
                <span className="stack" style={{gap: 6}}>
                  <span className="row gap-10 wrap-row"><strong className="display" style={{fontSize: 28, lineHeight: 1.05}}>{m.title}</strong>{m.main && <span className="stamp stamp-new">MOST USED</span>}</span>
                  <span className="body" style={{fontSize: 16}}>{m.sub}</span>
                </span>
                <span className="radio"><span /></span>
              </button>
            ))}
          </div>
          {mode === "buy" && <div style={{width: "min(360px, 100%)"}}><PieceSwitch piece={piece} setPiece={(p) => { setPiece(p); a.reset(); setResult(null); }} verb="Buy" /></div>}
          <p className={`note-line ${risk.c}`} style={{padding: "16px 20px", fontSize: 16}}>{risk.t}</p>
        </div>

        <aside aria-label="Order" className="card spot" {...spot}>
          {result ? (
            <div className="stack gap-20" style={{padding: 28, animation: "fade-up 320ms var(--ease)"}}>
              <span className="stamp stamp-live stamp-pop" style={{alignSelf: "flex-start"}}>DONE</span>
              <h2 className="display" style={{fontSize: 44, lineHeight: 1.02}}>{result.title}</h2>
              <p className="body">{result.body}</p>
              <div className="row gap-12 wrap-row">
                <button className="btn btn-primary" style={{flex: 1}} onClick={() => { setResult(null); a.reset(); setAmount(mode === "buy" ? "100" : "1"); }}>Make another trade</button>
                {a.hash && <a className="btn btn-secondary" href={explorerTx(a.hash)} target="_blank" rel="noreferrer">View receipt ↗</a>}
              </div>
            </div>
          ) : a.busy ? (
            <div className="stack gap-20 center" style={{padding: "48px 28px", alignItems: "center"}}>
              <GearAnim size={96} big />
              <h2 className="display" style={{fontSize: 36}}>{a.phase === "mining" ? "Writing it to the network" : "Confirm in your wallet"}</h2>
              <p className="body">{title}. Nothing moves until you approve it.</p>
            </div>
          ) : (
            <div className="stack gap-20" style={{padding: 28}}>
              <h2 className="display" style={{fontSize: 36, lineHeight: 1.05}}>{title}</h2>
              {a.noMarket ? (
                <p className="note-line">Nobody has opened pools for this split yet, so its pieces can&apos;t be bought or sold here. <Link href="/markets">Pick a split with a market →</Link></p>
              ) : (
                <>
                  <div className="stack gap-8">
                    <label htmlFor="tamt" className="label" style={{fontSize: 13, letterSpacing: ".08em"}}>{mode === "buy" ? "HOW MUCH CASH?" : `${name.toUpperCase()} SHARES`}</label>
                    <div className="field mid" data-invalid={!!a.err}>
                      {mode === "buy" && <span className="num muted" style={{fontSize: 36, marginRight: 4}}>$</span>}
                      <input id="tamt" inputMode="decimal" value={amount} aria-invalid={!!a.err} onChange={(e) => setAmount(cleanAmount(e.target.value, mode === "buy" ? 2 : 6))} />
                      {a.connected && <button className="btn-key" onClick={() => setAmount(a.useMax())}>USE MAX</button>}
                    </div>
                    <div className="field-foot"><span className="gold">{mode === "buy" ? `You pay ${money(n)}` : `You receive ${money(a.cashOut)}`}</span><span className="muted">{a.connected ? (mode === "buy" ? `Cash: ${money(a.max)}` : `You have ${qty(a.max)} ${plural(a.max, "share")}`) : ""}</span></div>
                    {a.err && <p role="alert" className="field-err">{a.err}</p>}
                  </div>
                  <div className="lines">
                    {lines.map(([k, v, mono, hl]) => (
                      <div key={k as string}><span className="k">{k}</span><span className={`v${mono ? " num" : ""}${hl ? " gold" : ""}`}>{v}</span></div>
                    ))}
                    <div style={{flexDirection: "column", gap: 6}}><span className="label">CAN I UNDO THIS?</span><span>{a.undo}</span></div>
                  </div>
                  <p className="small muted" style={{fontSize: 14}}>Price may shift by up to 0.5% before your order completes. You&apos;ll get at least {a.minGet}.</p>
                </>
              )}
              <button className="btn btn-primary btn-xl btn-block" disabled={a.cta.disabled} onClick={submit}>{a.cta.label}</button>
              {a.txError && <p role="alert" className="note-line risk">{a.txError}</p>}
              <span className="mono muted center" style={{fontSize: 12}}>{a.steps}</span>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
