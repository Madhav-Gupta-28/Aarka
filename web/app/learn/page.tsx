"use client";

import Link from "next/link";
import {useState} from "react";
import {Shell} from "@/components/Chrome";
import {Relic, Reveal} from "@/components/Relic";
import {RELIC} from "@/lib/relics";
import {spot} from "@/lib/ui";

/** An example, not a live quote: the same NVIDIA split every lesson uses. */
const K = 210;

const TABLETS: {n: string; id: string; title: string; lead: string; body: string; pull: string; img: string}[] = [
  {n: "I", id: "share", title: "The Share", lead: "A share is a small piece of a company. If NVIDIA’s price is $201.40, one share is worth $201.40.", body: "When the price goes up, your share is worth more. When it goes down, it’s worth less. Aarka starts with one of these shares, yours or a free practice one.", pull: "One share. One price. That’s where it starts.", img: RELIC.coinFull},
  {n: "II", id: "line", title: "The Line", lead: "The line is a price, like $210. It’s the point where your share is split in two.", body: "Each split also has an end date, like Oct 30. The line and the date never change once the split exists. Some splits have a line above today’s price, some below.", pull: "A price. Everything turns on it.", img: RELIC.chart},
  {n: "III", id: "halves", title: "Two Halves", lead: "Split your share and you get two pieces: a Floor and an Upside.", body: "The Floor gets the share’s value up to the line. The Upside gets everything above the line. Together they always add up to exactly one share, so you can put them back together at any moment.", pull: "Floor + Upside = one share. Always.", img: RELIC.coinFloor},
  {n: "IV", id: "endings", title: "Three Endings", lead: "On the end date, the final price decides what each piece pays. Here are three ways it could go.", body: "Pick an ending to see what each piece pays.", pull: "The Floor stops at the line. The Upside starts there.", img: RELIC.scales},
  {n: "V", id: "final", title: "The Final Day", lead: "On the end date, The Sun, our independent price source, sets the final price. Nobody at Aarka can change it.", body: "Then each Floor and Upside pays its value, in the stock itself: a Floor worth $210 pays out $210 of NVIDIA. You press Collect whenever you like. There’s no deadline.", pull: "The Sun sets it. You collect it.", img: RELIC.stele},
  {n: "VI", id: "risks", title: "The Risks, Honestly", lead: "You can lose money. The Upside can end at $0. The Floor still falls if the stock falls.", body: "If you sell the Upside, you give away any growth above the line. Prices can shift a little before an order completes. What you won’t face: borrowing, margin calls, or anyone force-selling your position.", pull: "Only use money you’re comfortable losing.", img: RELIC.astro(0.4)},
];

const ENDS: [number, string, string][] = [
  [150, "Falls to $150", "Below the line. The Floor gets the whole $150. The Upside gets nothing."],
  [210, "Ends at the line", "Exactly $210. The Floor gets $210. The Upside gets $0, because nothing is above the line."],
  [300, "Rises to $300", "Above the line. The Floor stops at $210. The Upside gets the $90 above it."],
];

const QS: {text: string; img: string; opts: [string, number][]}[] = [
  {text: "What do you expect NVIDIA to do by Oct 30?", img: RELIC.chart, opts: [["Rise a lot", 2], ["Stay about the same", 1], ["I’m not sure", 0]]},
  {text: "What matters more to you?", img: RELIC.scales, opts: [["Cash I can use today", 0], ["A big win if it rises", 2], ["Something that moves less", 1]]},
  {text: "If this piece ended at $0, how would you feel?", img: RELIC.stele, opts: [["Fine, it was a small bet", 2], ["Unhappy, but okay", 1], ["Not okay", 0]]},
];

const RES = [
  {t: "Keep the Floor, sell the Upside", b: "You keep most of NVIDIA’s value and get cash today for growth above $210.", r: "If NVIDIA ends above $210, that extra growth goes to someone else.", img: RELIC.coinFloor, cta: "Try it with practice shares", href: "/practice"},
  {t: "The Floor", b: "It costs less than a whole share and moves with NVIDIA up to $210.", r: "It stops at $210, and it still falls if NVIDIA falls.", img: RELIC.coinFloor, cta: "See Floor prices", href: "/markets"},
  {t: "The Upside", b: "It costs a fraction of a share and pays every dollar NVIDIA ends above $210.", r: "The Upside can end at $0. Only use money you’re comfortable losing.", img: RELIC.coinUp, cta: "See Upside prices", href: "/markets"},
];

const GLOSS: [string, string, string, string][] = [
  ["Split", "One share cut into a Floor and an Upside, around a line, until an end date.", RELIC.coinFull, ""],
  ["The line", "The price a split is cut around.", RELIC.chart, ""],
  ["Floor", "Gets the share’s value up to the line.", RELIC.coinFloor, ""],
  ["Upside", "Gets everything above the line. Can end at $0.", RELIC.coinUp, ""],
  ["End date", "The day the final price is set.", RELIC.astro(0.6), "tone-lapis"],
  ["The Sun", "Our independent, public price source.", RELIC.sun, "tone-lapis"],
  ["The Scales", "Keeps Floor + Upside priced fairly against the share.", RELIC.scales, "tone-up"],
  ["Collect", "Take what your ended pieces paid, in the stock itself.", RELIC.stele, "tone-up"],
];

const FAQ: [string, string][] = [
  ["Can I lose money?", "Yes. The Upside can end at $0, and the Floor falls if the stock falls. Only use money you’re comfortable losing. Practice shares let you learn with nothing at stake."],
  ["Can I undo a split?", "Yes. Hold a Floor and an Upside from the same split and you can put them back together into one share at any moment, even after the end date."],
  ["What happens if I forget to collect?", "Nothing bad. Your payout waits for you. There’s no deadline and no fee for waiting."],
  ["Can anyone force-sell my position?", "No. There’s no borrowing, so there are no margin calls. Your pieces stay yours until you act or the end date arrives."],
  ["Who sets the final price?", "The Sun, an independent public price source. Nobody at Aarka can change it."],
  ["What does it cost?", "A small network fee each time you act; on this testnet it’s paid in testnet ETH. Buying or selling a piece also pays the pool’s 0.3% fee, and the price may shift by up to 0.5% before your order completes."],
];

export default function Learn() {
  const [end, setEnd] = useState(2);
  const [qi, setQi] = useState(0);
  const [score, setScore] = useState(0);
  const [open, setOpen] = useState<Record<number, boolean>>({0: true});
  const done = qi >= QS.length;
  const cq = QS[Math.min(qi, 2)];
  const res = RES[score >= 5 ? 2 : score >= 3 ? 1 : 0];

  return (
    <Shell strip={false}>
      <div className="gridlines">
        <section className="wrap learn-top" style={{paddingBlock: "clamp(56px, 7.8vw, 112px) clamp(48px, 6.6vw, 96px)", borderBottom: "1px solid var(--line)"}}>
          <div className="stack gap-10"><span className="kicker">F3 · LEARN</span><span className="label" style={{fontSize: 13, lineHeight: 1.6}}>SIX TABLETS · 8 MIN READ</span></div>
          <h1 className="display h-xl rise">How a split <span className="px-em">works</span></h1>
          <p className="lead" style={{fontSize: 21}}>One share, one line, one date. Everything else follows from those three things.</p>
          <nav aria-label="Tablets" className="toc">
            {TABLETS.map((t) => <a key={t.id} href={`#${t.id}`}><span>{t.n}</span>{t.title}</a>)}
          </nav>
        </section>

        {TABLETS.map((t, i) => (
          <section key={t.id} id={t.id} className="section-tight" style={{borderBottom: "1px solid var(--line)", background: i % 2 ? "var(--bg-deep)" : "transparent", scrollMarginTop: 24}}>
            <div className="wrap tablet-sec">
              <div><span className="kicker">TABLET {t.n}</span><Relic src={t.img} size={128} /></div>
              <Reveal className="stack gap-24">
                <h2 className="display h-section" style={{fontSize: "clamp(44px, 5.6vw, 80px)"}}>{t.title}</h2>
                <p style={{fontSize: 21, lineHeight: 1.6}}>{t.lead}</p>
                <p className="body" style={{fontSize: 18, lineHeight: 1.65}}>{t.body}</p>
              </Reveal>
              <aside className="card spot lift" {...spot}>
                <span className="label">IN ONE LINE</span>
                <span className="display" style={{fontSize: 24, lineHeight: 1.25}}>{t.pull}</span>
              </aside>
              {t.id === "endings" && (
                <div className="stack gap-20" style={{marginTop: 24}}>
                  <div role="tablist" className="wrap-row gap-8">
                    {ENDS.map(([, label], k) => <button key={label} role="tab" aria-selected={end === k} className="chip" onClick={() => setEnd(k)}>{label}</button>)}
                  </div>
                  <div className="endings">
                    {ENDS.map(([p, , say], k) => {
                      const f = Math.min(p, K), u = Math.max(p - K, 0);
                      const tone = u ? "tone-up" : p < K ? "tone-down" : "";
                      return (
                        <article key={p} className={`card spot lift ending ${tone}${end === k ? " on" : ""}`} onClick={() => setEnd(k)} {...spot}>
                          <span className="label">NVIDIA ENDS AT</span>
                          <span className="num gold" style={{fontSize: 48, lineHeight: 1}}>${p}</span>
                          <div className="coins plinth">
                            <div className="stack" style={{alignItems: "center", gap: 6}}><Relic name="coinFloor" size={Math.round(40 + (f / K) * 40)} /><span className="mono" style={{fontSize: 12}}>FLOOR</span></div>
                            <div className="stack" style={{alignItems: "center", gap: 6, opacity: u ? 1 : 0.3}}><Relic name="coinUp" size={u ? Math.round(32 + (u / 90) * 48) : 32} /><span className="mono" style={{fontSize: 12}}>UPSIDE</span></div>
                          </div>
                          <div className="row num" style={{justifyContent: "space-between", fontSize: 16}}><span>Floor <span className="gold">${f.toFixed(2)}</span></span><span>Upside <span className="gold">${u.toFixed(2)}</span></span></div>
                          <p className="body" style={{fontSize: 16}}>{say}</p>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        ))}

        <section className="section deep" style={{borderBottom: "1px solid var(--line)"}}>
          <div className="wrap g12" style={{alignItems: "start"}}>
            <div className="stack gap-12" style={{gridColumn: "1 / span 3"}}><span className="kicker">THE QUIZ</span><span className="label" style={{fontSize: 13, lineHeight: 1.5}}>3 QUESTIONS<br />NO WRONG ANSWERS</span></div>
            <div className="stack gap-28 learn-quiz" style={{gridColumn: "4 / span 9"}}>
              <h2 className="display h-section">Which half is <span className="em">for me?</span></h2>
              <div className="card spot quiz" {...spot}>
                <div className="row gap-8">
                  {[0, 1, 2].map((i) => <span key={i} style={{width: 48, height: 6, background: i < qi ? "var(--up)" : i === qi ? "var(--accent)" : "var(--line)", transition: "background 320ms"}} />)}
                  <span className="mono muted ml-auto" style={{fontSize: 13}}>{done ? "DONE" : `QUESTION ${qi + 1} OF 3`}</span>
                </div>
                {!done ? (
                  <div className="quiz-q" key={qi}>
                    <Relic src={cq.img} size={128} />
                    <div className="stack gap-20">
                      <h3 className="display" style={{fontSize: "clamp(30px, 3vw, 44px)", lineHeight: 1.05}}>{cq.text}</h3>
                      <div className="stack gap-10">
                        {cq.opts.map(([label, v], i) => (
                          <button key={label} className="quiz-opt" onClick={() => { setQi(qi + 1); setScore(score + v); }}><span className="k">{"ABC"[i]}</span>{label}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="quiz-q" style={{gridTemplateColumns: "160px 1fr"}}>
                    <Relic src={res.img} size={160} />
                    <div className="stack gap-16" style={{alignItems: "flex-start", gap: 18}}>
                      <span className="stamp stamp-tag stamp-pop">YOUR MATCH</span>
                      <h3 className="display h-sub">{res.t}</h3>
                      <p className="body" style={{fontSize: 19}}>{res.b}</p>
                      <p className="note-line risk" style={{fontSize: 17, color: "var(--text)"}}>{res.r}</p>
                      <div className="row gap-12 wrap-row">
                        <Link href={res.href} className="btn btn-primary btn-lg">{res.cta}</Link>
                        <button className="btn btn-secondary btn-lg" onClick={() => { setQi(0); setScore(0); }}>Take it again</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="section" style={{borderBottom: "1px solid var(--line)"}}>
          <div className="wrap stack" style={{gap: 40}}>
            <div className="head12"><div className="kicker">GLOSSARY</div><h2 className="display h-section" style={{fontSize: "clamp(44px, 5.6vw, 80px)"}}>The words we use</h2></div>
            <div className="glossary">
              {GLOSS.map(([term, def, img, tone], i) => (
                <Reveal key={term} delay={(i % 4) * 60} className={`card-flat spot lift ${tone}`} {...spot}>
                  <Relic src={img} size={48} />
                  <strong className="display" style={{fontSize: 28, lineHeight: 1}}>{term}</strong>
                  <span className="small">{def}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap g12" style={{alignItems: "start"}}>
            <div className="kicker" style={{gridColumn: "1 / span 3"}}>QUESTIONS</div>
            <div className="stack faq learn-faq" style={{gridColumn: "4 / span 8"}}>
              <h2 className="display h-section" style={{fontSize: "clamp(44px, 5.6vw, 80px)", marginBottom: 32}}>Asked often</h2>
              {FAQ.map(([q, a], i) => (
                <div key={q}>
                  <button aria-expanded={!!open[i]} onClick={() => setOpen({...open, [i]: !open[i]})}>{q}<span>{open[i] ? "−" : "+"}</span></button>
                  {open[i] && <p>{a}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}
