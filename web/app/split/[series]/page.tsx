"use client";

import Link from "next/link";
import {useParams, useRouter, useSearchParams} from "next/navigation";
import {useEffect, useState} from "react";
import {ActionPanel} from "@/components/ActionPanel";
import {ParityModal} from "@/components/ParityModal";
import {Shell} from "@/components/Chrome";
import {DigitRoll} from "@/components/Motion";
import {Relic, Reveal, SunAnim} from "@/components/Relic";
import {Explain, SeriesStamp, SplitMissing, astroFrac} from "@/components/SplitBits";
import {TerminalSplit} from "@/components/TerminalSplit";
import {ChartLegend, PayoffChart, PresetChips, WhatIfTrack, outcomeText, payoff, useWhatIf} from "@/components/WhatIf";
import type {Kind} from "@/lib/actions";
import {marketFor} from "@/lib/contracts";
import {quoteFor, useBalances, useOneSeries, useParityAll, useSeries} from "@/lib/data";
import {ago, countdown, countdownWords, delta, endLong, endShort, money, short, stockFull, stockMono, stockName, lineLabel} from "@/lib/format";
import {explorerAddr} from "@/lib/tx";
import {RELIC} from "@/lib/relics";
import {spot, usePrefs} from "@/lib/ui";

export default function SplitDetail() {
  const {series} = useParams<{series: string}>();
  const {s, isLoading} = useOneSeries(series);
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const {data: bal} = useBalances(s);
  const {view} = usePrefs();
  const q = s ? quoteFor(s, parity) : undefined;
  const w = useWhatIf(q?.strike ?? 100, q?.spot ?? 0);
  const router = useRouter();
  const ask = useSearchParams().get("do");
  const [tab, setTab] = useState<Kind>(ask === "rejoin" || ask === "buy" || ask === "sell" ? ask : "split");

  // After the end date this page has nothing to trade, only a price to set and money to collect,
  // so it becomes the final-day page. Putting pairs back together still lives here.
  const ended = !!s && s.status !== 0;
  useEffect(() => { if (ended && ask !== "rejoin") router.replace(`/split/${series}/final`); }, [ended, ask, series, router]);
  const [details, setDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scales, setScales] = useState(false);

  if (!s || !q) return <Shell><SplitMissing loading={isLoading} /></Shell>;

  const name = stockName(s.underlyingSymbol);
  const K = lineLabel(q.strike);
  const p = parity?.[s.series.toLowerCase()];
  const fair = p ? p.gapBps < p.minDeviationBps : true;
  const tag = q.source === "market" ? "MARKET PRICE" : "ESTIMATE";

  return (
    <Shell>
      {scales && <ParityModal s={s} onClose={() => setScales(false)} />}
      <div className="crumbs">
        <Link href="/app">APP</Link><span>/</span><span>{name.toUpperCase()}</span><span>/</span>
        <span className="here">${K} LINE · ENDS {endShort(s.expiry).toUpperCase()}</span>
        <span className="ml-auto"><SeriesStamp s={s} /></span>
      </div>

      {view === "terminal" ? (
        <TerminalSplit s={s} q={q} bal={bal} w={w} />
      ) : (
        <>
          <section className="gridlines" style={{paddingBlock: "clamp(40px, 4.4vw, 64px) 48px"}}>
            <div className="wrap sd-head">
              <div className="sd-title">
                <div className="row gap-16">
                  <div aria-hidden className="monogram">{stockMono(s.underlyingSymbol)}</div>
                  <span className="label" style={{fontSize: 14, letterSpacing: ".08em"}}>{stockFull(s.underlyingSymbol).toUpperCase()} · {s.underlyingSymbol}</span>
                </div>
                <h1 className="display h-xl rise">{name} <span className="px-em">split</span></h1>
                <p className="lead">${K} line · ends {endShort(s.expiry)}. Split one share into a Floor and an Upside around ${K}.</p>
                <div className="row gap-12 wrap-row">
                  <a href="#act" className="btn btn-primary">Split, buy or sell ↓</a>
                  <a href="#act" onClick={() => setTab("rejoin")} className="btn btn-quiet">Put back together</a>
                </div>
              </div>
              <div className="sd-price">
                <span className="label" style={{fontSize: 13, letterSpacing: ".12em"}}>ONE {name.toUpperCase()} SHARE TODAY</span>
                <DigitRoll text={money(q.spot)} size={96} className="gold" style={{letterSpacing: "-.03em"}} />
                <span className={`mono ${q.fresh ? "up" : "down"}`} style={{fontSize: 14}}>{q.fresh ? "●" : "▲"} {q.fresh ? "Live" : "Delayed"} · updated {ago(s.spotUpdatedAt)}</span>
              </div>
              <div className="facts3">
                <div>
                  <div className="row gap-8"><span className="label" style={{fontSize: 13, letterSpacing: ".12em"}}>THE LINE</span><Explain name={name} /></div>
                  <span className="num" style={{fontSize: 40, lineHeight: 1}}>{money(q.strike)}</span>
                  <span className="body" style={{fontSize: 16}}>The Upside only has value if {name} ends above this.</span>
                </div>
                <div>
                  <span className="label" style={{fontSize: 13, letterSpacing: ".12em"}}>END DATE</span>
                  <span className="num" style={{fontSize: 40, lineHeight: 1}}>{endLong(s.expiry)}</span>
                  <span className="body" style={{fontSize: 16}}>On this day, The Sun sets the final price.</span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "96px 1fr", gap: 20, alignItems: "center"}}>
                  <Relic src={RELIC.astro(astroFrac(s.expiry))} size={96} alt="Dial: how much of the time has passed" />
                  <div className="stack gap-10">
                    <span className="label" style={{fontSize: 13, letterSpacing: ".12em"}}>TIME LEFT</span>
                    <span className="num" style={{fontSize: 32, lineHeight: 1}}>{countdown(s.expiry)}</span>
                    <span className="body" style={{fontSize: 16}}>{countdownWords(s.expiry)}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section aria-label="Floor plus Upside equals one share" className="wrap" style={{paddingBottom: "clamp(56px, 6.6vw, 96px)"}}>
            <div className="equation">
              <Reveal className="card spot lift eq-card" {...spot}>
                <Relic name="coinFloor" size={96} />
                <div className="stack gap-8"><span className="label" style={{fontSize: 13}}>FLOOR · {tag}</span><DigitRoll text={money(q.floor)} size={52} className="gold" /><span className="small">{name}&apos;s value up to ${K}</span></div>
              </Reveal>
              <div className="eq-op" aria-hidden>+</div>
              <Reveal className="card spot lift eq-card" delay={100} {...spot}>
                <Relic name="coinUp" size={96} />
                <div className="stack gap-8"><span className="label" style={{fontSize: 13}}>UPSIDE · {tag}</span><DigitRoll text={money(q.upside)} size={52} className="gold" /><span className="small">Everything above ${K}</span></div>
              </Reveal>
              <div className="eq-op" aria-hidden>=</div>
              <Reveal className="eq-card eq-total" delay={200}>
                <div style={{background: "#0E1116", padding: 4}}><Relic name="coinFull" size={88} /></div>
                <div className="stack gap-8"><span className="label">1 SHARE</span><DigitRoll text={money(q.floor + q.upside)} size={52} /><span style={{fontWeight: 500, fontSize: 15}}>{q.source !== "market" ? "Always, by design" : fair ? "Floor + Upside, priced by their pools" : `The share is ${money(q.spot)}. The Scales are closing the gap.`}</span></div>
              </Reveal>
            </div>
          </section>

          <section className="section-tight deep rule-top">
            <div className="wrap">
              <div className="head12">
                <div className="kicker">TABLET I</div>
                <h2 className="display h-section" style={{fontSize: "clamp(40px, 5.6vw, 80px)"}}>What if {name} ends at <span className="num gold" style={{fontSize: ".9em", letterSpacing: "-.03em"}}>{money(w.price)}</span>?</h2>
              </div>
              <div className="divider" aria-hidden />
              <div className="sd-whatif">
                <div className="card">
                  <div className="row" style={{justifyContent: "space-between", flexWrap: "wrap", gap: 12}}>
                    <span className="label" style={{fontSize: 13}}>WORTH ON {endShort(s.expiry).toUpperCase()}, PER PIECE</span><ChartLegend />
                  </div>
                  <div className="only-wide"><PayoffChart strike={q.strike} price={w.price} min={w.min} max={w.max} spot={q.spot} label={`THE LINE $${K}`} /></div>
                  <div className="only-narrow"><PayoffChart compact strike={q.strike} price={w.price} min={w.min} max={w.max} label="" /></div>
                  <div style={{margin: "0 16px 0 7%"}}><WhatIfTrack strike={q.strike} spot={q.spot} name={name} {...w} /></div>
                  <div className="wrap-row gap-8">
                    <span className="label" style={{fontSize: 13, marginRight: 8}}>TRY</span>
                    <PresetChips spot={q.spot} price={w.price} setPrice={w.setPrice} />
                    <span className="label ml-auto only-wide" style={{fontSize: 12}}>DRAG THE SUN · OR USE ← →</span>
                  </div>
                </div>
                <div>
                  {(["floor", "upside"] as const).map((k) => {
                    const v = payoff(w.price, q.strike)[k], base = k === "floor" ? q.floor : q.upside, d = v - base;
                    return (
                      <div key={k} className="worth-big" style={k === "upside" ? {borderStyle: "dashed", borderColor: "var(--accent)"} : undefined}>
                        <div className="row gap-10"><Relic name={k === "floor" ? "coinFloor" : "coinUp"} size={32} /><span className="mono" style={{fontSize: 13, letterSpacing: ".08em"}}>YOUR {k.toUpperCase()} WOULD BE WORTH</span></div>
                        <DigitRoll text={money(v)} size={64} className="gold" style={{letterSpacing: "-.03em"}} />
                        <span className={`mono ${d >= -0.005 ? "up" : "down"}`} style={{fontSize: 14}}>{Math.abs(d) < 0.005 ? "Same as today" : `${delta(d)} vs ${money(base)} today`}</span>
                      </div>
                    );
                  })}
                  <p aria-live="polite" className="body" style={{fontSize: 18, padding: "4px 4px 0"}}>{outcomeText(w.price, q.strike, name)}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="section-tight rule-top">
            <div className="wrap sd-lower">
              <div>
                <div className="stack gap-24">
                  <div className="kicker">TABLET II</div>
                  <h2 className="display h-sub">Which half is <span className="em">for you?</span></h2>
                  <div className="for-you">
                    <div>
                      <Relic name="coinFloor" size={48} />
                      <h3 className="display h-small">The Floor is for you if…</h3>
                      <p className="body">you want most of {name}&apos;s value and you&apos;re fine giving up anything above ${K}. It costs {money(q.floor)} today. It still falls if {name} falls.</p>
                    </div>
                    <div>
                      <Relic name="coinUp" size={48} />
                      <h3 className="display h-small">The Upside is for you if…</h3>
                      <p className="body">you think {name} will end well above ${K} by {endShort(s.expiry)}. It costs {money(q.upside)}. If {name} ends at or below ${K}, it&apos;s worth $0.</p>
                    </div>
                  </div>
                </div>

                <div className="trust2">
                  <div className="trust-card sun spot tone-lapis" {...spot}>
                    <SunAnim size={48} alt="The Sun" />
                    <div className="stack gap-6" style={{gap: 6}}>
                      <div className="row gap-8"><strong style={{fontWeight: 600}}>The Sun</strong><span className={`stamp ${q.fresh ? "stamp-live" : "stamp-delayed"}`} style={{padding: "3px 5px"}}>{q.fresh ? "LIVE" : "DELAYED"}</span></div>
                      <span className="small">Our independent price source. Last updated {ago(s.spotUpdatedAt)}.</span>
                      <Link href="/how#sun" className="mono" style={{fontSize: 13}}>Where prices come from →</Link>
                    </div>
                  </div>
                  <div className="trust-card spot tone-up" {...spot}>
                    <Relic name="scales" size={48} />
                    <div className="stack" style={{gap: 6}}>
                      <div className="row gap-8"><strong style={{fontWeight: 600}}>The Scales</strong>{p ? <span className={`stamp ${fair ? "stamp-live" : "stamp-delayed"}`} style={{padding: "3px 5px"}}>{fair ? "FAIR" : "BALANCING"}</span> : <span className="stamp stamp-ended" style={{padding: "3px 5px"}}>NO POOLS</span>}</div>
                      {p ? (
                        <span className="num" style={{fontSize: 14, lineHeight: 1.5, color: "var(--text-2)"}}>Floor + Upside = {money(q.floor + q.upside)}<br />Share = {money(q.spot)}</span>
                      ) : (
                        <span className="small">This split has no pools yet. Floor + Upside still always add up to one share.</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="drawer">
                  <button aria-expanded={details} onClick={() => setDetails(!details)}><span>DETAILS · FOR EXPERTS</span><span>{details ? "HIDE ▴" : "SHOW ▾"}</span></button>
                  {details && (
                    <dl>
                      <dt>Floor token</dt><dd><a href={explorerAddr(s.floorToken)} target="_blank" rel="noreferrer">{s.floorSymbol}</a></dd>
                      <dt>Upside token</dt><dd><a href={explorerAddr(s.upsideToken)} target="_blank" rel="noreferrer">{s.upsideSymbol}</a></dd>
                      <dt>Split contract</dt><dd className="row gap-12">{short(s.series)}
                        <button className="term-btn" onClick={() => { navigator.clipboard?.writeText(s.series).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>{copied ? "COPIED" : "COPY"}</button></dd>
                      <dt>Floor pays</dt><dd>min(P, {q.strike.toFixed(2)}) / P of a share token</dd>
                      <dt>Upside pays</dt><dd>max(P − {q.strike.toFixed(2)}, 0) / P of a share token</dd>
                      <dt>Price source</dt><dd>Chainlink {s.underlyingSymbol}/USD feed, <a href={explorerAddr(s.feed)} target="_blank" rel="noreferrer">{short(s.feed)}</a>. P = the last round at or before {endLong(s.expiry)}, no more than 26 hours old.</dd>
                      <dt>The Scales</dt><dd>{marketFor(s.series) ? <>Uniswap v4 parity hook <a href={explorerAddr(marketFor(s.series)!)} target="_blank" rel="noreferrer">{short(marketFor(s.series))}</a>. It trades the gap when Floor + Upside drift from the share. <button className="term-btn" onClick={() => setScales(true)}>WATCH IT WORK</button></> : "No pools yet."}</dd>
                      <dt>Prices shown</dt><dd>{q.source === "market" ? "Floor and Upside from their pools." : "Floor and Upside are a Black-Scholes estimate at 40% volatility. Nothing on-chain reads it."}</dd>
                      <dt>Cash</dt><dd>Test USDG, the quote asset every pool trades against. No value.</dd>
                    </dl>
                  )}
                </div>
              </div>
              <div id="act" style={{scrollMarginTop: 24}}><ActionPanel s={s} q={q} bal={bal} tab={tab} setTab={setTab} /></div>
            </div>
          </section>
        </>
      )}
    </Shell>
  );
}
