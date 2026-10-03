"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import {AnimatePresence, motion} from "motion/react";
import {useAccount, useBalance} from "wagmi";
import {FAUCET_URL} from "@/lib/chain";
import {useAction} from "@/lib/actions";
import {marketFor} from "@/lib/contracts";
import {quoteFor, stocksOf, useBalances, useParityAll, useSeries, type Parity} from "@/lib/data";
import type {SeriesView} from "@/lib/lens";
import {cleanAmount, countdown, endShort, money, n18, n6, nowSec, plural, qty, stockName, lineLabel} from "@/lib/format";
import {explorerTx} from "@/lib/tx";
import {spot} from "@/lib/ui";
import {CashFaucet, ShareFaucet} from "./Faucets";
import {Magnetic, Pills} from "./Kinetic";
import {DigitRoll} from "./Motion";
import {Moment, type Done} from "./Moment";
import {GearAnim, Relic} from "./Relic";
import {WhatIfTrack, payoff, useWhatIf} from "./WhatIf";

type Intent = "earn" | "bet";

const INTENTS: {id: Intent; title: string; line: string; keep: string; relics: [string, string]}[] = [
  {id: "earn", title: "Earn cash on my shares", line: "Keep the value up to a price. Sell the rest for cash today.", keep: "You keep the Floor", relics: ["coinFloor", "cash"]},
  {id: "bet", title: "Bet on a rise", line: "Pay a fraction of a share. Get every dollar above a price.", keep: "You buy the Upside", relics: ["cash", "coinUp"]},
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
  const [sym, setSym] = useState("NVDA");
  const [intent, setIntent] = useState<Intent>("earn");
  const [seriesAddr, setSeriesAddr] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");

  const options = useMemo(() => tradable(rows, parity, sym), [rows, parity, sym]);
  // Default to the split whose line sits closest above today's price: the classic covered call,
  // and the most honest bet. A person who wants another one picks it.
  const s = options.find((o) => o.series === seriesAddr) ?? (() => {
    if (!options.length) return undefined;
    const spotP = options[0].priceValid ? Number(options[0].spotPrice) : 0;
    const above = options.filter((o) => Number(o.strike) >= spotP);
    return (above.length ? above : options).sort((a, b) => Math.abs(Number(a.strike) - spotP) - Math.abs(Number(b.strike) - spotP))[0];
  })();
  const q = s ? quoteFor(s, parity) : undefined;
  const {data: bal} = useBalances(s);
  const {isConnected, address} = useAccount();
  // A wallet with no ETH cannot pay the fee for anything, not even the free shares, so say where to get it first.
  const {data: gas} = useBalance({address, query: {enabled: !!address, refetchInterval: 15_000}});
  const noGas = isConnected && !!gas && gas.value === 0n;

  const kind = intent === "earn" ? "splitSell" : "buy";
  const a = useAction({s, q, bal, kind, piece: "upside", amount});

  useEffect(() => { setAmount(intent === "earn" ? "1" : "100"); a.reset(); }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSeriesAddr(null); }, [sym]);

  const name = stockName(sym);
  const K = q ? q.strike : 0;
  const w = useWhatIf(K || 100, q?.spot ?? 0);
  const n = a.n;

  // What the position is worth if the stock ends at the what-if price.
  const end = payoff(w.price, K);
  const endValue = intent === "earn" ? n * end.floor + a.cashOut : a.piecesOut * end.upside;
  const holdValue = intent === "earn" ? n * w.price : n; // what doing nothing would have been worth
  const noShares = isConnected && bal && intent === "earn" && bal.share === 0n;
  const noCash = isConnected && bal && intent === "bet" && bal.cash === 0n;
  const closeMoment = useCallback(() => { setDone(null); a.reset(); }, [a.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  // The moment only follows the main step, not the permission step before it. What it shows is
  // taken when the button is pressed, because the quote moves once the trade lands.
  const [done, setDone] = useState<Done | null>(null);
  const go = async () => {
    const main = isConnected && !!s && !!q && !a.cta.label.startsWith("Step 1");
    const snap = main ? moment() : null;
    const h = await a.cta.onClick();
    if (snap && h) setDone({...snap, hash: h});
  };
  const moment = (): Omit<Done, "hash"> => {
    const kick = `${name} · $${lineLabel(K)} line · ends ${endShort(s!.expiry)}`;
    if (intent === "earn") {
      const cash = money(a.cashOut);
      return {
        half: "floor", big: cash, unit: "in cash, today",
        line: `You kept ${qty(n)} ${plural(n, "Floor")}: ${name}'s value up to $${lineLabel(K)} until ${endShort(s!.expiry)}. The cash is in your wallet.`,
        card: {kicker: `Split · ${kick}`, headline: "Kept the Floor. Sold the Upside.", big: cash, sub: `cash today, on ${qty(n)} ${name} ${plural(n, "share")}`, half: "floor",
               post: `Split my $${sym} at the $${lineLabel(K)} line. Kept the Floor, took ${cash} in cash today. One share, two halves, no liquidations.`},
      };
    }
    const pcs = qty(a.piecesOut, 3);
    return {
      half: "upside", big: pcs, unit: plural(a.piecesOut, "Upside"),
      line: `For ${money(n)}. Each pays every dollar ${name} ends above $${lineLabel(K)} on ${endShort(s!.expiry)}. If it ends at or below, they end at $0.`,
      card: {kicker: `Upside · ${kick}`, headline: `Bet on ${name} above $${lineLabel(K)}.`, big: money(n), sub: `for ${pcs} ${plural(a.piecesOut, "Upside")}, no margin, no liquidation`, half: "upside",
             post: `Took the Upside on $${sym} above $${lineLabel(K)} for ${money(n)}. Every dollar above the line is mine. No margin, no liquidations.`},
    };
  };

  return (
    <section id="app" className="app section-tight rule-top gridlines" aria-label="Choose your half">
      <div className="wrap app-wrap">
        <div className="app-head">
          <h2 className="display h-sub">Choose your <span className="em">half.</span></h2>
          <Pills id="stock" value={sym} onChange={setSym}
                 options={(stocks.length ? stocks : [{symbol: "NVDA", spot: 0}, {symbol: "TSLA", spot: 0}]).map((st) => ({
                   value: st.symbol, label: stockName(st.symbol), sub: st.spot ? money(st.spot) : "…",
                 }))} />
        </div>

        <div className="intents" role="radiogroup" aria-label="What do you want to do?">
          {INTENTS.map((it) => (
            <button key={it.id} role="radio" aria-checked={intent === it.id} className="intent spot" {...spot} onClick={() => setIntent(it.id)}>
              {intent === it.id && <motion.span layoutId="intent-ring" className="intent-ring" transition={{type: "spring", stiffness: 380, damping: 32}} />}
              <span className="intent-relics" aria-hidden>
                <Relic name={it.relics[0] as never} size={48} /><span className="mono muted">→</span><Relic name={it.relics[1] as never} size={48} />
              </span>
              <strong className="display intent-title">{it.title}</strong>
              <span className="small">{it.line}</span>
            </button>
          ))}
        </div>

        <div className="app-body">
          <div className="app-form">
            <div className="stack gap-10" data-tour="line">
              <span className="label">PRICE LINE · END DATE</span>
              {options.length ? (
                <Pills id="line" value={s?.series ?? ""} onChange={(v) => setSeriesAddr(v)}
                       options={options.map((o) => ({
                         value: o.series,
                         label: `$${lineLabel(Number(o.strike) / 1e8)}`,
                         sub: endShort(o.expiry),
                       }))} />
              ) : (
                <div className="skel" style={{height: 52}} />
              )}
            </div>

            <div className="stack gap-8">
              <label htmlFor="app-amt" className="label">{intent === "earn" ? `HOW MANY ${name.toUpperCase()} SHARES?` : "HOW MUCH CASH?"}</label>
              <div className="field big" data-invalid={!!a.err}>
                {intent === "bet" && <span className="num muted" style={{fontSize: 40, marginRight: 6}}>$</span>}
                <input id="app-amt" inputMode="decimal" value={amount} aria-invalid={!!a.err}
                       onChange={(e) => setAmount(cleanAmount(e.target.value, intent === "bet" ? 2 : 6))} />
                {a.connected && <button className="btn-key" onClick={() => setAmount(a.useMax())}>MAX</button>}
              </div>
              <div className="field-foot">
                <span className="gold">{q ? (intent === "earn" ? `= ${money(q.spot * n)} of ${name}` : `≈ ${qty(a.piecesOut, 3)} Upsides at ${money(q.upside)}`) : ""}</span>
                <span className="muted">{a.connected ? (intent === "earn" ? `You have ${qty(n18(bal?.share ?? 0n))}` : `Cash ${money(n6(bal?.cash ?? 0n))}`) : ""}</span>
              </div>
              {a.err && <p role="alert" className="field-err">{a.err}</p>}
            </div>

            <div className="whatif-mini">
              <div className="row" style={{justifyContent: "space-between", gap: 12}}>
                <span className="label">IF {name.toUpperCase()} ENDS AT <span className="gold">{money(w.price)}</span></span>
                <span className={`num ${endValue >= holdValue - 0.005 ? "up" : "down"}`} style={{fontSize: 22}}>{money(endValue)}</span>
              </div>
              <WhatIfTrack thin strike={K} spot={q?.spot} name={name} {...w} />
              <span className="small muted" style={{fontSize: 13}}>
                {intent === "earn"
                  ? (w.price <= K ? `Below the line you keep every dollar of ${name}, plus the cash.` : `Above $${lineLabel(K)} the gain goes to whoever bought your Upside.`)
                  : (w.price <= K ? "At or below the line, the Upside ends at $0." : `Each Upside pays ${money(w.price - K)}.`)}
              </span>
            </div>

            <AnimatePresence>
              {(noGas || noShares || noCash) && s && (
                <motion.div className="app-faucet" initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: "auto"}} exit={{opacity: 0, height: 0}}>
                  {noGas ? (
                    <>
                      <p className="small">This wallet has no test ETH, which every action needs for its network fee. The Robinhood Chain faucet gives it away.</p>
                      <a className="btn btn-secondary btn-block" href={FAUCET_URL} target="_blank" rel="noreferrer">Get test ETH ↗</a>
                    </>
                  ) : (
                    <>
                      <p className="small">{noShares ? `No ${name} in this wallet yet. Practice shares are free and follow the real price.` : "No practice cash yet. It's free, and it's all test money."}</p>
                      {noShares ? <ShareFaucet symbol={s.underlyingSymbol} token={s.underlying} spot={q?.spot ?? 0} /> : <CashFaucet />}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="app-out card spot" {...spot}>
            <AnimatePresence mode="wait">
              <motion.div key={intent} className="stack gap-16" initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -12}} transition={{duration: 0.28}}>
                <span className="label">{intent === "earn" ? "YOU GET, TODAY" : "YOU GET"}</span>
                <DigitRoll text={intent === "earn" ? money(a.cashOut) : `${qty(a.piecesOut, 3)}`} size={72} className="gold" style={{letterSpacing: "-.04em", maxWidth: "100%"}} />
                <p className="body" style={{fontSize: 17}}>
                  {!q ? "Reading live prices…" : intent === "earn"
                    ? <>in cash, and you keep {qty(n)} {plural(n, "Floor")}: {name}&apos;s value up to <b className="gold">{"$" + lineLabel(K)}</b> until {endShort(s!.expiry)}.</>
                    : <>{plural(a.piecesOut, "Upside")} for {money(n)}. Each pays every dollar {name} ends above <b className="gold">{"$" + lineLabel(K)}</b> on {endShort(s!.expiry)}.</>}
                </p>

                <p className={`note-line ${intent === "bet" ? "risk" : ""}`}>
                  {intent === "earn"
                    ? "You give up the growth above the line. The Floor still falls if the stock falls."
                    : "The Upside can end at $0. Only use money you're comfortable losing."}
                </p>

                <Magnetic className="btn-block-wrap">
                  <button className="btn btn-primary btn-xl btn-block" disabled={a.cta.disabled} onClick={go}>
                    {a.cta.spin && <GearAnim size={24} />}{a.cta.label}
                  </button>
                </Magnetic>
                <span className="mono muted center" style={{fontSize: 12}}>
                  {a.phase === "done" && a.hash ? <>DONE · <a href={explorerTx(a.hash)} target="_blank" rel="noreferrer">PUBLIC RECEIPT ↗</a></> : a.txError ?? `${a.steps} · PRICE MAY SHIFT UP TO 0.5%`}
                </span>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {s && (
          <div className="app-more row gap-16 wrap-row">
            <Link href={`/split/${s.series}`} className="mono" style={{fontSize: 13}}>Split details →</Link>
            <span className="mono muted" style={{fontSize: 13}}>Ends {endShort(s.expiry)}, 4:00 PM New York · {countdown(s.expiry)} left</span>
            {Number(s.expiry) - nowSec() < 86400 && <span className="stamp stamp-delayed">ENDS WITHIN A DAY</span>}
          </div>
        )}
      </div>
      <Moment done={done} onClose={closeMoment} />
    </section>
  );
}
