"use client";

import Link from "next/link";
import {motion, useScroll, useTransform} from "motion/react";
import {useRef} from "react";
import {FootFull, PriceStrip, SiteHeader} from "@/components/Chrome";
import {CoinBreak} from "@/components/CoinBreak";
import {Magnetic, Rise, SmoothScroll, WordReveal} from "@/components/Kinetic";
import {Relic, SunAnim} from "@/components/Relic";
import {SonarAscii} from "@/components/SonarAscii";
import {TeleportLink} from "@/components/Teleport";
import {pickFeatured, quoteFor, useParityAll, useSeries} from "@/lib/data";
import {money, stockName} from "@/lib/format";
import {spot, useReducedMotion} from "@/lib/ui";

/**
 * One page. Arrive, understand what you get, do it, watch it. The story explains the product in
 * one coin; the card below does it; the list below that tracks it. Pro turns the same section into
 * the terminal for people who want every number.
 */
export default function Home() {
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const reduce = useReducedMotion();
  const s = pickFeatured(rows);
  const q = s ? quoteFor(s, parity) : undefined;
  const name = s ? stockName(s.underlyingSymbol) : "NVIDIA";

  const hero = useRef<HTMLElement>(null);
  const {scrollYProgress} = useScroll({target: hero, offset: ["start start", "end start"]});
  const artY = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "18%"]);
  const copyY = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "-30%"]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <div className="page">
      <SmoothScroll />
      <SiteHeader overlay />
      <main id="main">
        <section ref={hero} className="hero hero-ascii">
          <motion.div className="hero-canvas" style={{y: artY}}>
            <SonarAscii className="ascii" />
          </motion.div>
          <div className="hero-fade" aria-hidden />
          <motion.div className="hero-copy wrap" style={{y: copyY, opacity: fade}}>
            <motion.div className="row gap-12 wrap-row" initial={reduce ? false : {opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} transition={{delay: 0.2}}>
              <span className="stamp stamp-practice">LIVE ON TESTNET</span>
              <span className="label" style={{letterSpacing: ".14em"}}>ONE SHARE · TWO HALVES · NO LIQUIDATIONS</span>
            </motion.div>
            <WordReveal as="h1" className="display h-hero">
              Split a stock into a floor and <span className="px-em">the upside.</span>
            </WordReveal>
            <motion.p className="lead" style={{maxWidth: 540}} initial={reduce ? false : {opacity: 0}} animate={{opacity: 1}} transition={{delay: 0.9, duration: 0.8}}>
              Earn cash on the shares you hold, or bet on a rise for a fraction of the price. Put the two halves back together anytime.
            </motion.p>
            <motion.div className="row gap-16 wrap-row" initial={reduce ? false : {opacity: 0, y: 16}} animate={{opacity: 1, y: 0}} transition={{delay: 1.1}}>
              <Magnetic><TeleportLink href="/app" className="btn btn-primary btn-lg">Choose your half →</TeleportLink></Magnetic>
              <a href="#split" className="btn btn-secondary btn-lg hero-ghost">See it split ↓</a>
            </motion.div>
            {q && (
              <motion.div className="hero-quote mono" initial={reduce ? false : {opacity: 0}} animate={{opacity: 1}} transition={{delay: 1.4}}>
                {s!.underlyingSymbol} <span className="gold">{money(q.spot)}</span> = Floor <span className="gold">{money(q.floor)}</span> + Upside <span className="gold">{money(q.upside)}</span>
              </motion.div>
            )}
          </motion.div>
          <span className="fig label">FIG. 1 · THE SUN ON ITS ALTAR · MOVE YOUR CURSOR</span>
          <div className="scroll-cue" aria-hidden><span /></div>
        </section>
        <PriceStrip />

        <div id="split">
          <CoinBreak name={name} spot={q?.spot} strike={q?.strike} floor={q?.floor} upside={q?.upside} />
        </div>

        <section className="section-tight rule-top gridlines open-app">
          <div className="wrap open-app-inner">
            <div className="stack gap-16">
              <span className="kicker">THE APP · NO SIGN-UP · FREE PRACTICE SHARES</span>
              <WordReveal className="display h-sub">Two buttons. <span className="em">Pick one.</span></WordReveal>
              <p className="lead" style={{maxWidth: 520}}>Earn cash on the shares you hold, or bet on a rise for a fraction of the price. It takes about a minute.</p>
            </div>
            <div className="open-app-cards">
              {[
                {t: "Earn cash on my shares", d: "You keep the Floor", r: "coinFloor"},
                {t: "Bet on a rise", d: "You buy the Upside", r: "coinUp"},
              ].map((c, i) => (
                <Rise key={c.t} delay={i * 90}>
                  <TeleportLink href="/app" className="card spot lift open-app-card" {...spot}>
                    <Relic name={c.r as never} size={56} />
                    <strong className="display" style={{fontSize: 28, lineHeight: 1.05}}>{c.t}</strong>
                    <span className="mono muted" style={{fontSize: 12, letterSpacing: ".12em"}}>{c.d.toUpperCase()} →</span>
                  </TeleportLink>
                </Rise>
              ))}
            </div>
          </div>
        </section>

        <section className="section-tight rule-top deep">
          <div className="wrap stack gap-32">
            <WordReveal className="display h-sub">Built so nobody has to <span className="em">trust us.</span></WordReveal>
            <div className="trust4">
              {[
                {r: <SunAnim size={64} alt="The Sun" />, t: "Independent prices", d: "Every final price comes from Chainlink. Nobody at Aarka can set or change it.", href: "/how#sun"},
                {r: <Relic name="scales" size={64} />, t: "Always adds up", d: "Floor + Upside is exactly one share, forever. A Uniswap v4 hook keeps their prices honest.", href: "/how#halves"},
                {r: <Relic name="stele" size={64} />, t: "Nothing to liquidate", d: "There is no borrowing anywhere, so there are no margin calls. Ever.", href: "/how#risks"},
                {r: <Relic name="coinFull" size={64} />, t: "Always reversible", d: "Hold both halves and you can rejoin them into a share at any moment. That never switches off.", href: "/how#halves"},
              ].map((c, i) => (
                <Rise key={c.t} delay={i * 90}>
                  <Link href={c.href} className="card spot lift trust-card2" {...spot}>
                    {c.r}
                    <strong className="display" style={{fontSize: 26, lineHeight: 1.1}}>{c.t}</strong>
                    <span className="small">{c.d}</span>
                    <span className="mono lapis" style={{fontSize: 12, marginTop: "auto"}}>READ HOW →</span>
                  </Link>
                </Rise>
              ))}
            </div>
            <Rise className="row gap-16 wrap-row">
              <Link href="/how" className="btn btn-secondary">How it works, start to finish</Link>
              <a href="https://github.com/Madhav-Gupta-28/Aarka" target="_blank" rel="noreferrer" className="btn btn-quiet">Contracts & audits on GitHub ↗</a>
            </Rise>
          </div>
        </section>
      </main>
      <FootFull />
    </div>
  );
}
