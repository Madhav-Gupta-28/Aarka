"use client";

import Link from "next/link";
import {useState} from "react";
import {useAction, FEE_TEXT, type Kind, type Piece} from "@/lib/actions";
import type {Balances, Quote} from "@/lib/data";
import type {SeriesView} from "@/lib/lens";
import {cleanAmount, money, qty} from "@/lib/format";
import {explorerTx} from "@/lib/tx";
import {GearAnim} from "./Relic";

export const PANEL_TABS: {kind: Kind; label: string; key: string}[] = [
  {kind: "split", label: "Split my share", key: "SPLIT"},
  {kind: "buy", label: "Buy", key: "BUY"},
  {kind: "sell", label: "Sell", key: "SELL"},
  {kind: "rejoin", label: "Put back together", key: "REJOIN"},
];

const TITLES: Record<Kind, (p: Piece) => string> = {
  split: () => "Split your share",
  buy: (p) => (p === "upside" ? "Buy an Upside with cash" : "Buy a Floor with cash"),
  sell: (p) => (p === "upside" ? "Sell Upsides you hold" : "Sell Floors you hold"),
  rejoin: () => "Put back together",
  splitSell: (p) => (p === "upside" ? "Keep the Floor, sell the Upside" : "Keep the Upside, sell the Floor"),
};

export function PieceSwitch({piece, setPiece, verb}: {piece: Piece; setPiece: (p: Piece) => void; verb: string}) {
  return (
    <div role="radiogroup" aria-label="Which piece" className="seg big" style={{gridAutoColumns: "minmax(0,1fr)", boxShadow: "none"}}>
      <span aria-hidden className="knob" style={{width: "calc(50% - 4px)", transform: piece === "upside" ? "translateX(100%)" : "none"}} />
      <button role="radio" aria-checked={piece === "floor"} onClick={() => setPiece("floor")}>{verb} a Floor</button>
      <button role="radio" aria-checked={piece === "upside"} onClick={() => setPiece("upside")}>{verb} an Upside</button>
    </div>
  );
}

/** The action panel on a split: four tabs, one amount, what you give and get, one button. */
export function ActionPanel({s, q, bal, tab, setTab}: {s: SeriesView; q?: Quote; bal?: Balances; tab: Kind; setTab: (k: Kind) => void}) {
  const [amount, setAmount] = useState(tab === "buy" ? "100" : "1");
  const [piece, setPiece] = useState<Piece>("upside");
  const a = useAction({s, q, bal, kind: tab, piece, amount});

  const pick = (k: Kind) => { setTab(k); setAmount(k === "buy" ? "100" : "1"); a.reset(); };
  const qtyLabel = tab === "split" ? `HOW MANY ${a.name.toUpperCase()} SHARES?` : tab === "rejoin" ? "HOW MANY PAIRS?"
    : tab === "buy" ? "HOW MUCH CASH?" : `HOW MANY ${piece === "upside" ? "UPSIDES" : "FLOORS"} TO SELL?`;
  const usdLine = !q ? "" : tab === "split" ? `= ${money(q.spot * a.n)}` : tab === "rejoin" ? `= ${money(q.spot * a.n)}`
    : tab === "buy" ? `≈ ${qty(a.piecesOut, 3)} ${piece === "upside" ? "Upsides" : "Floors"}` : `You receive ≈ ${money(a.cashOut)}`;
  const balLine = !a.connected ? "" : tab === "buy" ? `Cash: ${money(a.max)}`
    : tab === "rejoin" ? `You have ${qty(a.max)} ${a.max === 1 ? "pair" : "pairs"}`
      : tab === "sell" ? `You have ${qty(a.max)} ${piece === "upside" ? "Upsides" : "Floors"}` : `You have ${qty(a.max)} ${a.max === 1 ? "share" : "shares"}`;

  const note = tab === "buy"
    ? {t: piece === "upside" ? "The Upside can end at $0. Only use money you're comfortable losing. Price may shift by up to 0.5% before your order completes." : "The Floor's value stops at the line, and it still falls if the stock falls. Price may shift by up to 0.5%.", c: "risk"}
    : tab === "sell" ? {t: "Price may shift by up to 0.5% before your order completes.", c: ""}
      : tab === "rejoin" ? {t: "Always available, even after the end date. This can never be switched off.", c: "good"} : null;

  return (
    <aside aria-label="Actions" className="card">
      <div role="tablist" className="tabrow" style={{gridAutoColumns: "minmax(0, 1fr)"}}>
        {PANEL_TABS.map((t) => (
          <button key={t.kind} role="tab" aria-selected={tab === t.kind} onClick={() => pick(t.kind)}>{t.label}</button>
        ))}
      </div>
      <div className="act-body" key={tab}>
        <h3 className="display h-small" style={{animation: "fade-up 240ms var(--ease)"}}>{TITLES[tab](piece)}</h3>
        {(tab === "buy" || tab === "sell") && <PieceSwitch piece={piece} setPiece={(p) => { setPiece(p); a.reset(); }} verb={tab === "buy" ? "Buy" : "Sell"} />}

        {a.ended && tab !== "rejoin" ? (
          <div className="stack gap-12">
            <p className="body">This split has ended. You can still put pairs back together, and collect once the final price is set.</p>
            <Link className="btn btn-primary" href={`/split/${s.series}/final`}>Go to final price day</Link>
          </div>
        ) : (
          <>
            <div className="stack gap-8">
              <label htmlFor="amt" className="label" style={{fontSize: 13, letterSpacing: ".08em"}}>{qtyLabel}</label>
              <div className="field" data-invalid={!!a.err}>
                {tab === "buy" && <span className="num muted" style={{fontSize: 32, marginRight: 4}}>$</span>}
                <input id="amt" inputMode="decimal" value={amount} aria-invalid={!!a.err}
                       onChange={(e) => setAmount(cleanAmount(e.target.value, tab === "buy" ? 2 : 6))} />
                {a.connected && <button className="btn-key" onClick={() => setAmount(a.useMax())}>USE MAX</button>}
              </div>
              <div className="field-foot"><span className="gold">{usdLine}</span><span className="muted">{balLine}</span></div>
              {a.err && <p role="alert" className="field-err">{a.err}</p>}
            </div>

            <div className="kv">
              <div><span className="k">YOU GIVE</span><div className="v">{a.give.map((g) => <span key={g.k}><span>{g.k}</span><span className="n">{g.v}</span></span>)}</div></div>
              <div><span className="k">YOU GET</span><div className="v">{a.get.map((g) => <span key={g.k}><span>{g.k}</span><span className="n gold">{g.v}</span></span>)}</div></div>
              <div><span className="k">FEES</span><div className="v">{FEE_TEXT}{tab !== "split" && tab !== "rejoin" ? ", plus the 0.3% pool fee" : ""}</div></div>
              <div><span className="k">UNDO?</span><div className="v">{a.undo}</div></div>
            </div>

            {note && <p className={`note-line ${note.c}`}>{note.t}</p>}
            {a.noMarket && <p className="note-line">Nobody has opened pools for this split yet, so its pieces can&apos;t be bought or sold here. You can still split and put back together.</p>}
          </>
        )}

        {!(a.ended && tab !== "rejoin") && (
          <>
            <button className="btn btn-primary btn-xl btn-block" disabled={a.cta.disabled} onClick={() => a.cta.onClick()}>
              {a.cta.spin && <GearAnim size={24} />}{a.cta.label}
            </button>
            <span className="mono muted center" style={{fontSize: 12, lineHeight: 1.4}}>
              {a.phase === "done" && a.hash ? <>DONE · <a href={explorerTx(a.hash)} target="_blank" rel="noreferrer">VIEW PUBLIC RECEIPT ↗</a></> : a.txError ?? a.steps}
            </span>
          </>
        )}
      </div>
    </aside>
  );
}
