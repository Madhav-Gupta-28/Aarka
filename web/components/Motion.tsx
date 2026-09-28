"use client";

import {useEffect, useState} from "react";
import {RELIC} from "@/lib/relics";
import {useReducedMotion} from "@/lib/ui";
import {Relic} from "./Relic";

/**
 * A price that rolls: each digit moves on its own, 180ms. With reduced motion the digits simply
 * swap. The text is also there once, whole, for screen readers.
 */
export function DigitRoll({text, size, className = "", style}: {text: string; size: number; className?: string; style?: React.CSSProperties}) {
  const reduce = useReducedMotion();
  const h = Math.round(size * 1.08);
  return (
    <span className={`num ${className}`} style={{display: "inline-flex", height: h, overflow: "hidden", fontSize: size, lineHeight: `${h}px`, ...style}}>
      <span className="sr-only" style={{position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)"}}>{text}</span>
      {text.split("").map((ch, i) => {
        if (!/[0-9]/.test(ch)) return <span key={`s${i}`} aria-hidden>{ch}</span>;
        const d = Number(ch);
        return (
          <span key={`d${i}-${text.length}`} aria-hidden style={{display: "inline-block", height: h, overflow: "hidden"}}>
            <span style={{display: "flex", flexDirection: "column", transform: `translateY(${-d * h}px)`, transition: reduce ? "none" : "transform 180ms cubic-bezier(.2,.7,.2,1)"}}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <span key={n} style={{height: h, display: "block"}}>{n}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** A ticking countdown to an end date: 33d 04h 12m 09s. */
export function Countdown({to, size = 72}: {to: bigint; size?: number}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Number(to) - now);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  const cell = (v: string | number, l: string) => (
    <span style={{display: "flex", alignItems: "baseline", gap: 4}}>
      <span className="num gold" style={{fontSize: size, lineHeight: 1, letterSpacing: "-.04em"}}>{v}</span>
      <span className="mono muted" style={{fontSize: Math.round(size * 0.3)}}>{l}</span>
    </span>
  );
  return (
    <div role="timer" aria-label={`Ends in ${d} days ${h} hours`} style={{display: "flex", gap: size * 0.3, flexWrap: "wrap"}}>
      {cell(d, "d")}{cell(pad(h), "h")}{cell(pad(m), "m")}{cell(pad(sec), "s")}
    </div>
  );
}

/** The sun rising over the horizon while the final price is being set, in 4px steps. */
export function SunRise({size, height}: {size: number; height: number}) {
  const [k, setK] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) { setK(24); return; }
    const t = setInterval(() => setK((v) => (v + 1) % 64), 200);
    return () => clearInterval(t);
  }, [reduce]);
  const rise = Math.min(k, 24) / 24;
  const y = height - size * 0.35 - (height - size * 0.35 - (height - size) / 2 - 8) * rise;
  return (
    <Relic src={RELIC.sunFrames[k % 4]} size={size} alt="The sun rising over the horizon"
           style={{position: "absolute", left: "50%", top: Math.round(y / 4) * 4, transform: "translateX(-50%)"}} />
  );
}

/**
 * One whole coin splits into a Floor and an Upside, in five stepped frames. `rejoin` plays it
 * backwards: two coins meet and become one share.
 */
export function CoinSplit({size, rejoin, count, shareLabel, floorValue, upsideValue}: {
  size: number; rejoin?: boolean; count: string; shareLabel: string; floorValue: string; upsideValue: string;
}) {
  const reduce = useReducedMotion();
  const [k, setK] = useState(reduce ? 4 : 0);
  useEffect(() => {
    if (reduce) { setK(4); return; }
    setK(0);
    let i = 0;
    const t = setInterval(() => { i++; setK(i); if (i >= 4) clearInterval(t); }, 180);
    return () => clearInterval(t);
  }, [rejoin, count, reduce]);

  const gap = [0, 0.18, 0.38, 0.58, 0.72][k] * size * 1.6;
  const sep = rejoin ? size * 1.6 * 0.72 - gap : gap;
  const whole = rejoin ? k >= 4 : k === 0;
  const lab = (t: string, v: string) => (
    <div style={{display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 10, opacity: whole ? 0 : 1, transition: "opacity 160ms"}}>
      <span className="label">{t}</span>
      <span className="num gold" style={{fontSize: size > 100 ? 20 : 16}}>{v}</span>
    </div>
  );
  const coin = (src: string, dx: number, t: string, v: string) => (
    <div style={{position: "absolute", left: "50%", top: 0, transform: `translateX(calc(-50% + ${dx}px))`, display: "flex", flexDirection: "column", alignItems: "center"}}>
      <Relic src={src} size={size} />
      {lab(t, v)}
    </div>
  );
  return (
    <div role="img" aria-label={rejoin ? "A Floor and an Upside merge into one whole share" : "One whole share splits into a Floor and an Upside"}
         style={{position: "relative", width: size * 3.4, maxWidth: "100%", height: size + 56}}>
      {whole ? (
        <div style={{position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center"}}>
          <Relic src={RELIC.coinFull} size={size} />
          <span className="label" style={{marginTop: 10}}>{shareLabel}</span>
        </div>
      ) : (
        <>
          {coin(RELIC.coinFloor, -sep, `${count} FLOOR`, floorValue)}
          {coin(RELIC.coinUp, sep, `${count} UPSIDE`, upsideValue)}
        </>
      )}
    </div>
  );
}
