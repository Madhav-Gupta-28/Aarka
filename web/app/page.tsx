"use client";

import Link from "next/link";
import {FootFull, PriceStrip, SiteHeader, TabBar} from "@/components/Chrome";
import {Relic, Reveal, SunAnim} from "@/components/Relic";
import {ChartLegend, PayoffChart, PresetChips, WhatIfTrack, WorthPair, outcomeText, useWhatIf} from "@/components/WhatIf";
import {pickFeatured, quoteFor, useParityAll, useSeries} from "@/lib/data";
import {ago, endShort, money, stockName} from "@/lib/format";
import {spot} from "@/lib/ui";

export default function Home() {
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const s = pickFeatured(rows);
  const q = s ? quoteFor(s, parity) : undefined;
  const name = s ? stockName(s.underlyingSymbol) : "NVIDIA";
  const K = q?.strike ?? 210;
  const S = q?.spot ?? 0;
  const w = useWhatIf(K, S);
  const m = (v?: number) => (v === undefined ? "…" : money(v));
  const end = s ? endShort(s.expiry) : "…";
  const detail = s ? `/split/${s.series}` : "/markets";

  return (
    <div className="page">
      <SiteHeader overlay />
      <main id="main">
        {/* HERO */}
        <section className="hero">
          <div className="hero-art" aria-hidden />
          <div className="hero-glow" aria-hidden />
          <div className="hero-fade" aria-hidden />
          <div className="hero-copy wrap">
            <div className="row gap-12 wrap-row">
              <span className="stamp stamp-practice stamp-pop" style={{"--d": "200ms"} as React.CSSProperties}>PRACTICE MODE OPEN</span>
              <span className="label rise" style={{letterSpacing: ".14em", "--d": "300ms"} as React.CSSProperties}>TABLET 0 · ONE SHARE, TWO PIECES</span>
            </div>
            <h1 className="display h-hero">
              <span className="rise" style={{display: "block", "--d": "80ms"} as React.CSSProperties}>Split a stock into</span>
              <span className="rise" style={{display: "block", "--d": "180ms"} as React.CSSProperties}>a floor and <span className="px-em">the upside</span>.</span>
            </h1>
            <p className="lead rise" style={{maxWidth: 520, "--d": "320ms"} as React.CSSProperties}>
              Keep the part you want. Sell or trade the part you don&apos;t. Put them back together anytime.
            </p>
            <div className="row gap-16 wrap-row rise" style={{"--d": "420ms"} as React.CSSProperties}>
              <Link href="/practice" className="btn btn-primary btn-lg">Try it with practice shares</Link>
              <a href="#how" className="btn btn-secondary btn-lg" style={{background: "color-mix(in srgb, var(--bg) 60%, transparent)"}}>See how it works</a>
            </div>
            <div className="label rise" style={{letterSpacing: ".08em", "--d": "520ms"} as React.CSSProperties}>NO BORROWING · NOBODY CAN FORCE-SELL YOUR POSITION</div>
          </div>
          <span className="fig label">FIG. 1 · THE SUN ON ITS ALTAR, HELD BY THE SCALES</span>
        </section>
        <PriceStrip />

        {/* I · HOW IT WORKS */}
        <section id="how" className="section gridlines">
          <div className="wrap">
            <div className="head12"><div className="kicker">TABLET I</div><h2 className="display h-section">How it works</h2></div>
            <div className="divider" aria-hidden />
            <div className="steps3">
              <Reveal as="article" className="card spot lift step-card" {...spot}>
                <div className="row" style={{justifyContent: "space-between", alignItems: "baseline"}}><span className="numeral">I</span><span className="label">STEP 1 OF 3</span></div>
                <div className="plinth step-art"><Relic name="coinFull" size={128} alt="A whole coin: one share" /></div>
                <h3 className="display h-card">Bring one share</h3>
                <p className="body">Start with a share you already own, like {name}. Or use free practice shares to learn first.</p>
              </Reveal>
              <div className="step-arrow" aria-hidden>→</div>
              <Reveal as="article" className="card spot lift step-card" delay={120} {...spot}>
                <div className="row" style={{justifyContent: "space-between", alignItems: "baseline"}}><span className="numeral">II</span><span className="label">STEP 2 OF 3</span></div>
                <div className="plinth step-art gap-16"><Relic name="coinFloor" size={96} alt="Solid coin: the Floor" /><span className="mono muted" style={{fontSize: 22}}>+</span><Relic name="coinUp" size={96} alt="Ring coin: the Upside" /></div>
                <h3 className="display h-card">Get a Floor and an Upside</h3>
                <p className="body">Pick a line and an end date. Your share becomes two pieces that always add up to exactly one share.</p>
              </Reveal>
              <div className="step-arrow" aria-hidden>→</div>
              <Reveal as="article" className="card spot lift step-card" delay={240} {...spot}>
                <div className="row" style={{justifyContent: "space-between", alignItems: "baseline"}}><span className="numeral">III</span><span className="label">STEP 3 OF 3</span></div>
                <div className="plinth step-art" style={{gap: 40}}>
                  <div className="stack gap-10" style={{alignItems: "center"}}><Relic name="coinFloor" size={96} /><span className="stamp-word gold" style={{font: "400 12px/1 var(--f-px)"}}>KEEP</span></div>
                  <div className="stack gap-10" style={{alignItems: "center"}}><Relic name="coinUp" size={96} /><span className="muted" style={{font: "400 12px/1 var(--f-px)"}}>SELL</span></div>
                </div>
                <h3 className="display h-card">Keep, sell, or hold both</h3>
                <p className="body">Keep the piece you want and sell the other for cash today. Hold both, and you can put them back together anytime.</p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* II · WHAT IF */}
        <section className="section deep rule-top">
          <div className="wrap">
            <div className="head12 with-note">
              <div className="kicker">TABLET II</div>
              <h2 className="display h-section">What <span className="em">if?</span></h2>
              <p className="note">Try it here. No wallet needed. {s ? `Real prices, updated ${ago(s.spotUpdatedAt)}.` : "Reading real prices…"}</p>
            </div>
            <div className="divider" aria-hidden />
            <div className="whatif-grid">
              <div className="stack gap-32">
                <div className="stack gap-8">
                  <div className="label" style={{fontSize: 13, letterSpacing: ".08em"}}>{name.toUpperCase()} SPLIT · ${Math.round(K)} LINE · ENDS {end.toUpperCase()}</div>
                  <div className="display" style={{fontSize: "clamp(28px, 3vw, 44px)", lineHeight: 1.1}}>
                    If {name} ends at <span className="num gold" style={{fontSize: ".9em"}}>{money(w.price)}</span>…
                  </div>
                </div>
                <div className="stack gap-12">
                  <WhatIfTrack strike={K} spot={S} name={name} {...w} />
                  <div className="row mono muted" style={{justifyContent: "space-between", fontSize: 13}}>
                    <span>${w.min}</span><span style={{color: "var(--text)"}}>│ THE LINE ${Math.round(K)}</span><span>${w.max}</span>
                  </div>
                </div>
                <div className="wrap-row gap-8"><PresetChips spot={S} price={w.price} setPrice={w.setPrice} /></div>
                <WorthPair price={w.price} strike={K} floorToday={q?.floor ?? 0} upsideToday={q?.upside ?? 0} />
                <p aria-live="polite" className="body" style={{fontSize: 18}}>{outcomeText(w.price, K, name)}</p>
              </div>
              <div className="card spot tone-lapis chart-card" {...spot}>
                <div className="row" style={{justifyContent: "space-between", gap: 12, flexWrap: "wrap"}}>
                  <span className="label" style={{fontSize: 13, letterSpacing: ".12em"}}>WORTH ON {end.toUpperCase()}, PER PIECE</span>
                  <ChartLegend />
                </div>
                <div className="only-wide"><PayoffChart strike={K} price={w.price} min={w.min} max={w.max} label={`THE LINE $${Math.round(K)}`} /></div>
                <div className="only-narrow"><PayoffChart compact strike={K} price={w.price} min={w.min} max={w.max} label="" /></div>
                <p className="small muted">The Floor rises with {name} until ${Math.round(K)}, then stays flat. The Upside is $0 until ${Math.round(K)}, then rises dollar for dollar.</p>
              </div>
            </div>
          </div>
        </section>

        {/* III · THREE WAYS */}
        <section className="section gridlines rule-top">
          <div className="wrap">
            <div className="head12"><div className="kicker">TABLET III</div><h2 className="display h-section">Three ways people use Aarka</h2></div>
            <div className="divider" aria-hidden />
            <div className="ways">
              <Reveal as="article" className="card spot lift way-main" {...spot}>
                <div className="stack gap-20" style={{padding: "clamp(24px, 3vw, 40px)"}}>
                  <span className="kicker" style={{letterSpacing: ".12em"}}>01 · KEEP THE FLOOR, SELL THE UPSIDE</span>
                  <h3 className="display h-sub" style={{fontSize: "clamp(32px, 3.9vw, 56px)", lineHeight: 1.02}}>Get paid today for growth <span className="em">you don&apos;t expect.</span></h3>
                  <p className="body">Split your {name} share, keep the Floor, and sell the Upside. Today that&apos;s about {m(q?.upside)} in cash, while you keep {name}&apos;s value up to ${Math.round(K)}.</p>
                  <div className="risk"><span className="stamp-word down">RISK</span><span className="body" style={{fontSize: 16}}>If {name} ends above ${Math.round(K)}, that extra growth goes to whoever holds the Upside.</span></div>
                </div>
                <div className="plinth way-art"><Relic name="coinFloor" size={128} /></div>
              </Reveal>
              <Reveal as="article" className="card spot lift tone-lapis way-side" delay={100} {...spot}>
                <Relic name="coinUp" size={64} />
                <span className="kicker" style={{letterSpacing: ".12em"}}>02 · BUY THE UPSIDE</span>
                <h3 className="display h-card">A small bet on a <span className="em">big rise.</span></h3>
                <p className="body" style={{fontSize: 16}}>{m(q?.upside)} instead of {m(q?.spot)} for a whole share. It gains a dollar for every dollar {name} ends above ${Math.round(K)}.</p>
                <div className="risk stack"><span className="stamp-word down">RISK</span><span className="body" style={{fontSize: 16}}>The Upside can end at $0. Only use money you&apos;re comfortable losing.</span></div>
              </Reveal>
              <Reveal as="article" className="card spot lift tone-up way-side" delay={200} {...spot}>
                <Relic name="coinFloor" size={64} />
                <span className="kicker" style={{letterSpacing: ".12em"}}>03 · BUY THE FLOOR</span>
                <h3 className="display h-card">Hold something <span className="em">steadier.</span></h3>
                <p className="body" style={{fontSize: 16}}>{m(q?.floor)} instead of {m(q?.spot)}. It moves with {name} up to the line.</p>
                <div className="risk stack"><span className="stamp-word down">RISK</span><span className="body" style={{fontSize: 16}}>Its value stops at ${Math.round(K)}. It still falls if {name} falls.</span></div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* IV · BUILT TO BE FAIR */}
        <section className="section deep rule-top">
          <div className="wrap">
            <div className="head12"><div className="kicker">TABLET IV</div><h2 className="display h-section">Built to be <span className="em">fair</span></h2></div>
            <div className="divider" aria-hidden />
            <div className="fair4">
              <Reveal className="fair-cell">
                <SunAnim size={96} alt="The Sun" />
                <h3 className="display h-small" style={{fontSize: 32}}>The Sun</h3>
                <p className="body" style={{fontSize: 16}}>Every final price comes from an independent, public price source. Nobody at Aarka can change it.</p>
                <Link href="/sun" className="mono" style={{fontSize: 14}}>How prices are set →</Link>
              </Reveal>
              <Reveal className="fair-cell" delay={100}>
                <Relic name="scales" size={64} />
                <h3 className="display h-small" style={{fontSize: 32}}>The Scales</h3>
                <p className="body" style={{fontSize: 16}}>Keeps Floor + Upside priced fairly against the share.</p>
                {q && <div className="num gold" style={{fontSize: 14, lineHeight: 1.5}}>{money(q.floor)} + {money(q.upside)} = {money(q.floor + q.upside)}</div>}
              </Reveal>
              <Reveal className="fair-cell" delay={200}>
                <Relic name="stele" size={64} />
                <h3 className="display h-small" style={{fontSize: 32}}>Nobody can force-sell you</h3>
                <p className="body" style={{fontSize: 16}}>There is no borrowing, so there are no margin calls. Your position is yours until you act or the end date arrives.</p>
              </Reveal>
              <Reveal className="fair-cell" delay={300}>
                <Relic name="coinFull" size={64} />
                <h3 className="display h-small" style={{fontSize: 32}}>You can always put it back together</h3>
                <p className="body" style={{fontSize: 16}}>Hold a Floor and an Upside from the same split and you can rejoin them into one share at any moment. That can never be switched off.</p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* PULL QUOTE */}
        <section className="dither rule-top" style={{paddingBlock: "clamp(72px, 11vw, 160px)"}}>
          <div className="wrap quote">
            <div className="display quote-mark" aria-hidden>“</div>
            <Reveal as="blockquote" style={{margin: 0}} className="stack gap-32">
              <p className="display" style={{fontSize: "clamp(40px, 7.2vw, 104px)", lineHeight: 1, letterSpacing: "-.02em"}}>
                A Floor and an Upside always add up to one whole share. <span className="em">Nothing is hidden in between.</span>
              </p>
              <footer className="label" style={{fontSize: 14, letterSpacing: ".14em"}}>THE FIRST RULE OF EVERY SPLIT</footer>
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <section className="section-tight rule-top">
          <div className="wrap cta">
            <div className="medallion-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/art/medallion.webp" width={400} height={400} alt="The Aarka sun medallion" className="medallion" />
            </div>
            <div className="stack gap-28">
              <span className="stamp stamp-practice" style={{alignSelf: "flex-start"}}>PRACTICE MODE</span>
              <h2 className="display h-sub" style={{fontSize: "clamp(40px, 5.6vw, 80px)"}}>Learn it with <span className="em">free practice shares.</span></h2>
              <p className="body" style={{fontSize: 18, maxWidth: 560}}>Practice shares follow real prices but have no cash value. Everything in practice mode is clearly marked.</p>
              <div className="row gap-16 wrap-row">
                <Link href="/practice" className="btn btn-primary btn-lg">Get free practice shares</Link>
                <Link href="/learn" className="btn btn-quiet btn-lg">Read how it works</Link>
                <Link href={detail} className="btn btn-quiet btn-lg">See the {name} split</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <FootFull />
      <TabBar />
    </div>
  );
}
