"use client";

import Link from "next/link";
import {motion, useScroll, useTransform} from "motion/react";
import {useRef} from "react";
import {FootFull, SiteHeader} from "@/components/Chrome";
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
  // What one share is worth in the same pools the halves trade in, so the sum on screen always adds up.
  const worth = q ? (q.source === "market" ? q.floor + q.upside : q.spot) : undefined;

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
            </motion.div>
            <WordReveal as="h1" className="display h-hero">
              Split a stock into a floor and <span className="px-em">the upside.</span>
            </WordReveal>
            <motion.p className="lead" style={{maxWidth: 540}} initial={reduce ? false : {opacity: 0}} animate={{opacity: 1}} transition={{delay: 0.9, duration: 0.8}}>
              Keep the Floor and take cash today, or buy the Upside and bet on a rise.
            </motion.p>
            <motion.div className="row gap-16 wrap-row" initial={reduce ? false : {opacity: 0, y: 16}} animate={{opacity: 1, y: 0}} transition={{delay: 1.1}}>
              <Magnetic><TeleportLink href="/app" className="btn btn-primary btn-lg">Choose your half →</TeleportLink></Magnetic>
              <a href="#split" className="btn btn-secondary btn-lg hero-ghost">See it split ↓</a>
            </motion.div>
            {q && (
              <motion.div className="hero-quote mono" initial={reduce ? false : {opacity: 0}} animate={{opacity: 1}} transition={{delay: 1.4}}>
                Floor <span className="gold">{money(q.floor)}</span> + Upside <span className="gold">{money(q.upside)}</span> = <span className="gold">{money(worth!)}</span>, one {s!.underlyingSymbol} share
              </motion.div>
            )}
          </motion.div>
          <div className="scroll-cue" aria-hidden><span /></div>
        </section>

        <div id="split">
          <CoinBreak name={name} spot={worth} strike={q?.strike} floor={q?.floor} upside={q?.upside} />
        </div>

        <section className="section-tight rule-top deep">
          <div className="wrap stack gap-32">
            <WordReveal className="display h-sub">Built so nobody has to <span className="em">trust us.</span></WordReveal>
            <div className="trust4">
              {[
                {r: <SunAnim size={64} alt="The Sun" />, t: "Independent prices", d: "Final prices come from Chainlink, not us.", href: "/how#sun"},
                {r: <Relic name="scales" size={64} />, t: "Always adds up", d: "Floor + Upside = one share. A Uniswap v4 hook enforces it.", href: "/how#scales"},
                {r: <Relic name="stele" size={64} />, t: "Nothing to liquidate", d: "No borrowing, so no margin calls.", href: "/how#risks"},
                {r: <Relic name="coinFull" size={64} />, t: "Always reversible", d: "Rejoin both halves into a share, any time.", href: "/how#halves"},
              ].map((c, i) => (
                <Rise key={c.t} delay={i * 90}>
                  <Link href={c.href} className="card spot lift trust-card2" {...spot}>
                    {c.r}
                    <strong className="display" style={{fontSize: 26, lineHeight: 1.1}}>{c.t}</strong>
                    <span className="small">{c.d}</span>
                  </Link>
                </Rise>
              ))}
            </div>
            <Rise className="row gap-16 wrap-row">
              <Link href="/how" className="btn btn-secondary">How it works</Link>
              <a href="https://github.com/Madhav-Gupta-28/Aarka" target="_blank" rel="noreferrer" className="btn btn-quiet">Contracts & audits on GitHub ↗</a>
            </Rise>
          </div>
        </section>
      </main>
      <FootFull />
    </div>
  );
}
