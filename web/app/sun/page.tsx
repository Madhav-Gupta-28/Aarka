"use client";

import {useState} from "react";
import {FootCompact, SiteHeader, TabBar} from "@/components/Chrome";
import {Relic, Reveal} from "@/components/Relic";
import {stocksOf, useSeries} from "@/lib/data";
import {ago, money, short, stockName} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {explorerAddr} from "@/lib/tx";
import {spot} from "@/lib/ui";

export default function TheSun() {
  const {data: rows} = useSeries();
  const stocks = stocksOf(rows);
  const [tech, setTech] = useState(false);

  const steps = [
    {n: "I", title: "The Sun watches", img: RELIC.sun, body: "An independent, public price network reports each stock’s price whenever it moves and at least once a day. Anyone can see it. Aarka only reads it."},
    {n: "II", title: "The end time arrives", img: RELIC.astro(0.63), body: "Each split has a fixed end time, like 4:00 pm New York time on its end date. It is set when the split is created and never moves."},
    {n: "III", title: "The last price before it is carved", img: RELIC.stele, body: "The last price The Sun published at or before the end time becomes the final price. Anyone can carve it; for one hour it can only be corrected by a later price the rules allow. Then it cannot change."},
  ];

  return (
    <div className="page">
      <SiteHeader />
      <main id="main">
        <section className="sun-hero">
          <div className="wrap copy">
            <span className="mono lapis rise" style={{fontSize: 14, letterSpacing: ".14em"}}>F4 · THE SUN · OUR INDEPENDENT PRICE SOURCE</span>
            <h1 className="display h-page rise" style={{"--d": "120ms", color: "#F7F4ED"} as React.CSSProperties}>Every price, from an <span className="px-em">independent</span> source.</h1>
            <p className="lead rise" style={{maxWidth: 520, fontSize: 21, "--d": "240ms"} as React.CSSProperties}>Nobody at Aarka can change it. The same public source sets the final price for every split, on every end date.</p>
          </div>
          <span className="fig label">FIG. 2 · THE SUN DISK, WEIGHED BY THE SCALES</span>
        </section>

        <section className="section gridlines">
          <div className="wrap stack gap-32">
            <div className="head12 with-note">
              <div className="kicker">TABLET I</div>
              <h2 className="display h-section" style={{fontSize: "clamp(44px, 5.6vw, 80px)"}}>Right now</h2>
              <p className="note" style={{fontSize: 15}}>Live means a price arrived in the last 26 hours: the daily heartbeat, plus a margin. Delayed means it&apos;s running late.</p>
            </div>
            <div className="feeds">
              {!rows && [0, 1].map((i) => <div key={i} className="skel" style={{height: 190}} />)}
              {stocks.map((st, i) => (
                <Reveal key={st.symbol} delay={i * 80} className={`feed spot lift ${st.fresh ? "tone-up" : "tone-down"}${st.fresh ? "" : " late"}`} {...spot}>
                  <div className="row" style={{justifyContent: "space-between"}}>
                    <strong className="display" style={{fontSize: 26, lineHeight: 1}}>{stockName(st.symbol)}</strong>
                    <span className={`stamp ${st.fresh ? "stamp-live" : "stamp-delayed"}`}>{st.fresh ? "LIVE" : "DELAYED"}</span>
                  </div>
                  <span className={`num ${st.fresh ? "gold" : "muted"}`} style={{fontSize: 30, lineHeight: 1}}>{st.spot ? money(st.spot) : "—"}</span>
                  <span className="mono muted" style={{fontSize: 13, lineHeight: 1.4}}>{st.symbol}/USD · Updated {ago(st.updatedAt)}</span>
                  <span className="small" style={{fontSize: 14}}>{st.fresh ? "Prices are flowing." : "Your funds are fine. Putting pieces back together always works."}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="section deep rule-top">
          <div className="wrap stack gap-48" style={{gap: 40}}>
            <div className="head12"><div className="kicker">TABLET II</div><h2 className="display h-section" style={{fontSize: "clamp(44px, 5.6vw, 80px)"}}>How the final price is chosen</h2></div>
            <div className="how3">
              {steps.map((p, i) => (
                <div key={p.n} style={{display: "contents"}}>
                  <Reveal as="article" delay={i * 120} className="card spot lift" {...spot}>
                    <div className="row" style={{justifyContent: "space-between", alignItems: "baseline"}}><span className="numeral">{p.n}</span><Relic src={p.img} size={96} /></div>
                    <h3 className="display h-card" style={{fontSize: 34}}>{p.title}</h3>
                    <p className="body">{p.body}</p>
                  </Reveal>
                  {i < 2 && <div className="step-arrow" aria-hidden>→</div>}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section rule-top">
          <div className="wrap quiet">
            <div className="kicker">TABLET III</div>
            <div className="stack gap-24">
              <h2 className="display h-sub" style={{fontSize: "clamp(40px, 5vw, 72px)"}}>What if the price source goes <span className="em">quiet?</span></h2>
              <p className="body" style={{fontSize: 19, lineHeight: 1.6}}>Sometimes a price arrives late. When that happens we show a Delayed stamp, so you always know how fresh a number is.</p>
              <p className="body" style={{fontSize: 19, lineHeight: 1.6}}>Every split still gets a final price. If The Sun has no price in the 26 hours before an end time, the split waits; a week after the end date, the last price before the end is accepted at any age. Nothing is decided by Aarka.</p>
              <p className="body" style={{fontSize: 19, lineHeight: 1.6}}>And through all of it, you can always put your two halves back together into one share. That never pauses.</p>
            </div>
            <div className="card-flat spot lift tone-lapis stack gap-12" style={{padding: 24, borderColor: "var(--lapis-line)", background: "var(--lapis-bg)"}} {...spot}>
              <Relic name="sunDim" size={64} />
              <span className="stamp-word down">DELAYED · EXAMPLE</span>
              <span className="small">Last price 30 hours ago. Your funds are fine. The split waits for The Sun, and putting pairs back together still works.</span>
            </div>
          </div>
        </section>

        <section className="wrap" style={{paddingBottom: 112}}>
          <div className="drawer">
            <button aria-expanded={tech} onClick={() => setTech(!tech)} style={{height: 64}}><span>TECHNICAL DETAILS · FOR EXPERTS</span><span>{tech ? "HIDE ▴" : "SHOW ▾"}</span></button>
            {tech && (
              <dl style={{gridTemplateColumns: "260px 1fr"}}>
                <dt>Provider</dt><dd>Chainlink Data Feeds. On this testnet the feeds are stand-ins that carry the real mainnet prices, copied across by script.</dd>
                <dt>Feeds</dt><dd>{stocks.map((st, i) => <span key={st.symbol}>{i ? " · " : ""}<a href={explorerAddr(st.feed)} target="_blank" rel="noreferrer">{st.symbol}/USD {short(st.feed)}</a></span>)}</dd>
                <dt>Update rule</dt><dd>On deviation, and a 24-hour heartbeat</dd>
                <dt>Final price</dt><dd>The last round with updatedAt ≤ expiry, no more than 26 hours old. The next round must be missing or published after expiry.</dd>
                <dt>Challenge window</dt><dd>1 hour after settling. Anyone may replace the round with a strictly later one that still qualifies. Claims open after.</dd>
                <dt>If quiet at expiry</dt><dd>Seven days after expiry, the last round before expiry is accepted at any age. redeem() (put back together) is never disabled.</dd>
                <dt>Admin keys</dt><dd>None can set or override a price. No proxies, no upgrades, no pause on user funds.</dd>
              </dl>
            )}
          </div>
        </section>
      </main>
      <FootCompact />
      <TabBar />
    </div>
  );
}
