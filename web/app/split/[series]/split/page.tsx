"use client";

import Link from "next/link";
import {useParams, useRouter, useSearchParams} from "next/navigation";
import {Suspense, useEffect, useState} from "react";
import {Mark} from "@/components/Mark";
import {CoinSplit} from "@/components/Motion";
import {GearAnim, Relic} from "@/components/Relic";
import {SplitMissing} from "@/components/SplitBits";
import {FEE_TEXT, useAction} from "@/lib/actions";
import {quoteFor, useBalances, useOneSeries, useParityAll, useSeries} from "@/lib/data";
import {cleanAmount, endShort, money, plural, qty, stockName} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {explorerTx} from "@/lib/tx";
import {spot} from "@/lib/ui";

export default function SplitFlowPage() {
  return <Suspense><SplitFlow /></Suspense>;
}

function SplitFlow() {
  const {series} = useParams<{series: string}>();
  const router = useRouter();
  const search = useSearchParams();
  const rejoin = search.get("mode") === "rejoin";
  const {s, isLoading} = useOneSeries(series);
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const {data: bal} = useBalances(s);
  const q = s ? quoteFor(s, parity) : undefined;
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState("1");
  const [running, setRunning] = useState<"perm" | "main" | null>(null);
  const [doneAt, setDoneAt] = useState<Date | null>(null);
  const a = useAction({s, q, bal, kind: rejoin ? "rejoin" : "split", piece: "upside", amount});

  useEffect(() => { setStep(1); setRunning(null); a.reset(); }, [rejoin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s || !q) return <div className="page"><SplitMissing loading={isLoading} /></div>;

  const name = stockName(s.underlyingSymbol);
  const K = Math.round(q.strike);
  const n = a.n;
  const pl = (w: string) => plural(n, w);
  const err = !!a.err || n <= 0;
  const stageNames = rejoin ? ["How many pairs", "What you’ll get", "Put together", "Done"] : ["How many shares", "What you’ll get", "Permission & split", "Done"];

  async function doPerm() {
    setRunning("perm");
    const cta = a.cta;
    if (cta.onClick) await cta.onClick();
    setRunning(null);
  }
  async function doMain() {
    setRunning("main");
    const h = await a.cta.onClick();
    setRunning(null);
    if (h) { setDoneAt(new Date()); setStep(4); }
  }

  const permDone = !a.needsApproval;
  const busy = a.busy;
  type G = {name: string; sub: string; state: "act" | "spin" | "done" | "wait"; cta: string; go: () => void; mark: string};
  const gears: G[] = rejoin
    ? [{name: "Put back together", sub: `Your ${qty(n)} ${pl("Floor")} and ${qty(n)} ${pl("Upside")} become ${qty(n)} ${name} ${pl("share")}.`, state: busy ? "spin" : "act", cta: "Put back together", go: doMain, mark: "1"}]
    : [
        {name: "Give permission", sub: `Step 1: Give Aarka permission to use your ${name} share. This lets the split happen; it moves nothing yet.`,
         state: permDone ? "done" : busy && running === "perm" ? "spin" : "act", cta: "Give permission", go: doPerm, mark: "1"},
        {name: "Split", sub: `Your ${qty(n)} ${pl("share")} ${n === 1 ? "becomes" : "become"} ${qty(n)} ${pl("Floor")} and ${qty(n)} ${pl("Upside")}.`,
         state: !permDone ? "wait" : busy && running === "main" ? "spin" : "act", cta: "Split my share", go: doMain, mark: "2"},
      ];

  const give = rejoin
    ? [{k: `${qty(n)} ${pl("Floor")}`, v: money(q.floor * n), icon: RELIC.coinFloor}, {k: `${qty(n)} ${pl("Upside")}`, v: money(q.upside * n), icon: RELIC.coinUp}]
    : [{k: `${qty(n)} ${name} ${pl("share")}`, v: money(q.spot * n), icon: RELIC.coinFull}];
  const get = rejoin
    ? [{k: `${qty(n)} ${name} ${pl("share")}`, v: money(q.spot * n), icon: RELIC.coinFull}]
    : [{k: `${qty(n)} ${pl("Floor")}`, v: money(q.floor * n), icon: RELIC.coinFloor}, {k: `${qty(n)} ${pl("Upside")}`, v: money(q.upside * n), icon: RELIC.coinUp}];

  return (
    <div className="page">
      <header className="flow-head">
        <Link href="/" aria-label="Aarka home"><Mark size={32} /></Link>
        <span className="label ctx" style={{fontSize: 13, letterSpacing: ".08em"}}>{name.toUpperCase()} SPLIT · ${K} LINE · ENDS {endShort(s.expiry).toUpperCase()}</span>
        <span className="stamp stamp-practice">PRACTICE MODE</span>
        <div className="seg ml-auto" role="group" aria-label="Flow" style={{gridAutoColumns: "minmax(0,1fr)", boxShadow: "none"}}>
          <span aria-hidden className="knob" style={{width: "calc(50% - 4px)", transform: rejoin ? "translateX(100%)" : "none"}} />
          <button aria-pressed={!rejoin} onClick={() => router.replace(`/split/${s.series}/split`)}>SPLIT</button>
          <button aria-pressed={rejoin} onClick={() => router.replace(`/split/${s.series}/split?mode=rejoin`)}>REJOIN</button>
        </div>
        <Link href={`/split/${s.series}`} className="btn btn-secondary btn-sm">Exit</Link>
      </header>

      <nav aria-label="Progress" className="stages">
        {stageNames.map((label, i) => {
          const k = i + 1, done = k < step || step === 4, cur = k === step && step !== 4;
          return (
            <div key={label} className={`stage${done ? " done" : cur ? " cur" : ""}`} aria-current={cur ? "step" : undefined}>
              <span className="mk">{done ? "✓" : k}</span><span className="nm">{label}</span>
            </div>
          );
        })}
      </nav>

      <main className="wrap gridlines flow-body" style={{flex: 1}}>
        <div className="main">
          {step === 1 && (
            <div className="flow-step">
              <span className="kicker">STEP 1 OF 3</span>
              <h1 className="display h-page">{rejoin ? "How many pairs?" : "How many shares?"}</h1>
              <p className="lead" style={{maxWidth: 560, fontSize: 18}}>
                {rejoin ? `A pair is one Floor and one Upside from the same split. Together they become one ${name} share again.`
                  : "Each share you split becomes one Floor and one Upside. Start with one if this is new to you."}
              </p>
              <div className="stack gap-10" style={{maxWidth: 560}}>
                <label htmlFor="amt" className="label" style={{fontSize: 13, letterSpacing: ".08em"}}>{rejoin ? "PAIRS TO PUT BACK TOGETHER" : `${name.toUpperCase()} SHARES TO SPLIT`}</label>
                <div className="field big" data-invalid={!!a.err}>
                  <input id="amt" inputMode="decimal" value={amount} aria-invalid={!!a.err} onChange={(e) => setAmount(cleanAmount(e.target.value))} />
                  {a.connected && <button className="btn-key" style={{height: 48, padding: "0 16px", fontSize: 14}} onClick={() => setAmount(a.useMax())}>USE MAX</button>}
                </div>
                <div className="field-foot" style={{fontSize: 16}}>
                  <span className="gold">= {money(q.spot * n)} today</span>
                  <span className="muted">{a.connected ? (rejoin ? `You have ${qty(a.max)} matching ${plural(a.max, "pair")}` : `You have ${qty(a.max)} ${name} ${plural(a.max, "share")}`) : "Connect to see what you hold"}</span>
                </div>
                {a.err && <p role="alert" className="field-err" style={{fontSize: 16}}>{a.err}{!rejoin && <> <Link href="/practice">Get practice shares →</Link></>}</p>}
              </div>
              <div className="row gap-16"><button className="btn btn-primary btn-xl" disabled={err} onClick={() => setStep(2)}>Continue</button></div>
            </div>
          )}

          {step === 2 && (
            <div className="flow-step">
              <span className="kicker">STEP 2 OF 3</span>
              <h1 className="display h-page">Here&apos;s what you&apos;ll <span className="px-em">get</span></h1>
              <div className="plinth" style={{height: 280, display: "flex", alignItems: "center", justifyContent: "center"}}>
                <CoinSplit size={128} rejoin={rejoin} count={qty(n)} shareLabel={`${qty(n)} ${name.toUpperCase()} ${n === 1 ? "SHARE" : "SHARES"}`} floorValue={money(q.floor * n)} upsideValue={money(q.upside * n)} />
              </div>
              <p className="lead" style={{fontSize: 19}}>
                {rejoin ? `Your ${qty(n)} ${pl("Floor")} and ${qty(n)} ${pl("Upside")} merge back into ${qty(n)} ${name} ${pl("share")}, worth ${money(q.spot * n)} today. You can split it again anytime.`
                  : `Your ${qty(n)} ${pl("share")} ${n === 1 ? "becomes" : "become"} ${qty(n)} ${pl("Floor")} (${money(q.floor * n)}) and ${qty(n)} ${pl("Upside")} (${money(q.upside * n)}). Together they are still worth exactly one share each. You can put these back together anytime.`}
              </p>
              <div className="row gap-16 wrap-row"><button className="btn btn-primary btn-xl" onClick={() => setStep(3)}>Looks right</button><button className="btn btn-secondary btn-xl" onClick={() => setStep(1)}>Back</button></div>
            </div>
          )}

          {step === 3 && (
            <div className="flow-step">
              <span className="kicker">STEP 3 OF 3</span>
              <h1 className="display h-page">{rejoin ? "One step, then done" : "Two quick steps"}</h1>
              {!a.connected ? (
                <div className="stack gap-16" style={{alignItems: "flex-start"}}>
                  <p className="lead">Connect your wallet to confirm. Nothing moves until you approve each step.</p>
                  <button className="btn btn-primary btn-lg" onClick={() => a.cta.onClick()}>{a.cta.label}</button>
                </div>
              ) : (
                <div className="card-flat">
                  {gears.map((g) => (
                    <div key={g.name} className={`gear-row ${g.state}`}>
                      <div className="mk">{g.state === "spin" ? <GearAnim size={24} /> : g.state === "done" ? "✓" : g.mark}</div>
                      <div className="stack" style={{gap: 6}}><strong className="display" style={{fontSize: 28, lineHeight: 1.05}}>{g.name}</strong><span className="body" style={{fontSize: 16}}>{g.sub}</span></div>
                      {g.state === "act" && <button className="btn btn-primary" onClick={g.go} disabled={busy}>{g.cta}</button>}
                      {g.state === "spin" && <span className="label">{a.phase === "mining" ? "WRITING IT TO THE NETWORK…" : "CONFIRM IN YOUR WALLET…"}</span>}
                    </div>
                  ))}
                </div>
              )}
              {a.txError && <p role="alert" className="note-line risk">{a.txError}</p>}
              <p className="small muted">Nothing leaves your wallet until you confirm. If a step fails, nothing is taken.</p>
            </div>
          )}

          {step === 4 && (
            <div className="flow-step">
              <span className="stamp stamp-live stamp-pop" style={{alignSelf: "flex-start"}}>DONE</span>
              <div className="receipt" style={{padding: "clamp(24px, 3.3vw, 48px)", display: "flex", flexDirection: "column", gap: 20}}>
                <div className="row" style={{justifyContent: "space-between"}}>
                  <span className="label" style={{letterSpacing: ".14em"}}>RECEIPT · INSCRIBED {doneAt?.toLocaleString("en-GB", {day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"}).toUpperCase().replace(",", " ·")}</span>
                  <Relic name="stele" size={64} />
                </div>
                <h2 className="display" style={{fontSize: "clamp(40px, 5vw, 72px)", lineHeight: 1, animation: "carve 900ms var(--ease) both"}}>
                  {rejoin ? `You now hold ${qty(n)} more ${name} ${pl("share")}.` : `You now hold ${qty(n)} ${pl("Floor")} and ${qty(n)} ${pl("Upside")}.`}
                </h2>
                <p style={{fontSize: 18, lineHeight: 1.55}}>
                  {rejoin ? "Your pieces are whole again. Nothing else changed." : `From the ${name} split, $${K} line, ending ${endShort(s.expiry)}. Keep both, or sell the Upside for about ${money(q.upside * n)} in cash today.`}
                </p>
                <div className="rule" style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr"}}>
                  <div className="stack" style={{padding: "14px 0", gap: 6}}><span className="label">GAVE</span><span className="num" style={{fontSize: 18}}>{rejoin ? `${qty(n)} F + ${qty(n)} U` : `${qty(n)} ${pl("share")}`}</span></div>
                  <div className="stack" style={{padding: "14px 0", gap: 6}}><span className="label">GOT</span><span className="num" style={{fontSize: 18}}>{rejoin ? `${qty(n)} ${pl("share")}` : `${qty(n)} F + ${qty(n)} U`}</span></div>
                  <div className="stack" style={{padding: "14px 0", gap: 6}}><span className="label">NETWORK FEE</span><span className="num" style={{fontSize: 18}}>TESTNET ETH</span></div>
                </div>
                {a.hash && <a href={explorerTx(a.hash)} target="_blank" rel="noreferrer">View public receipt ↗</a>}
              </div>
              <div className="row gap-16 wrap-row">
                {rejoin ? <Link href={`/split/${s.series}/split`} className="btn btn-primary btn-xl">Split it again</Link>
                  : <Link href={`/split/${s.series}/trade`} className="btn btn-primary btn-xl">Sell the Upside</Link>}
                <Link href="/ledger" className="btn btn-secondary btn-xl">View my ledger</Link>
              </div>
            </div>
          )}
        </div>

        <aside className="card spot" {...spot}>
          <div className="label" style={{padding: "20px 24px", borderBottom: "1px solid var(--line)"}}>SUMMARY · UPDATES AS YOU GO</div>
          <div className="summary">
            <div><span className="label">YOU GIVE</span>{give.map((g) => <div key={g.k} className="it"><span><Relic src={g.icon} size={24} />{g.k}</span><span className="num" style={{fontSize: 18}}>{g.v}</span></div>)}</div>
            <div><span className="label">YOU GET</span>{get.map((g) => <div key={g.k} className="it"><span><Relic src={g.icon} size={24} />{g.k}</span><span className="num gold" style={{fontSize: 18}}>{g.v}</span></div>)}</div>
            <div className="it" style={{flexDirection: "row"}}><span className="muted" style={{fontWeight: 400, fontSize: 16}}>Network fee</span><span className="mono" style={{fontSize: 14}}>{FEE_TEXT.replace("Network fee: ", "")}</span></div>
            <div><span className="label">CAN I UNDO THIS?</span><span style={{fontSize: 16, lineHeight: 1.5}}><strong className="up">Yes.</strong> {rejoin ? "You can split it again anytime." : "Put them back together anytime to get your share back."}</span></div>
          </div>
        </aside>
      </main>
    </div>
  );
}
