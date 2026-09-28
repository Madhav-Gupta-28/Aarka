"use client";

import {useCallback, useRef, useState} from "react";
import {RELIC} from "@/lib/relics";
import {delta, money} from "@/lib/format";
import {Relic} from "./Relic";

/** Price range for the slider: roughly half the line to two thirds above it, in $10 steps. */
export function rangeFor(strike: number) {
  const min = Math.max(1, Math.floor((strike * 0.48) / 10) * 10);
  const max = Math.ceil((strike * 1.67) / 10) * 10;
  return {min, max};
}

export function useWhatIf(strike: number, spot: number) {
  const {min, max} = rangeFor(strike);
  const start = Math.round(Math.min(max, Math.max(min, spot ? spot * 1.3 : strike * 1.24)));
  const [raw, setRaw] = useState<number | null>(null);
  const price = raw ?? start;
  const setPrice = useCallback((p: number) => setRaw(Math.max(min, Math.min(max, Math.round(p)))), [min, max]);
  return {price, setPrice, min, max};
}

export const payoff = (p: number, k: number) => ({floor: Math.min(p, k), upside: Math.max(p - k, 0)});

export function outcomeText(p: number, k: number, name: string) {
  const {floor, upside} = payoff(p, k);
  return p <= k
    ? `The Upside would be worth $0, because ${name} ended at or below the ${money(k, 0)} line. The Floor would be worth the full ${money(floor)}.`
    : `The Floor stops at the ${money(k, 0)} line. Everything above it, ${money(upside)} per share, goes to the Upside.`;
}

const niceMax = (v: number) => {
  const step = v > 400 ? 100 : 50;
  return Math.ceil(v / step) * step;
};

/**
 * What each piece is worth at the end, for every end price. The Floor is solid and rises until
 * the line, then stays flat. The Upside is hatched: $0 until the line, then dollar for dollar.
 */
export function PayoffChart({strike, price, min, max, spot, compact, terminal, label}: {
  strike: number; price: number; min: number; max: number; spot?: number; compact?: boolean; terminal?: boolean; label: string;
}) {
  const W = compact ? 343 : 800, H = compact ? 210 : 340;
  const L = compact ? 40 : 56, R = compact ? 8 : 16, T = compact ? 12 : 16, B = compact ? 28 : 36;
  const fs = compact ? 12 : 13;
  const yMax = niceMax(Math.max(strike, max - strike) * 1.4);
  const X = (v: number) => L + ((v - min) / (max - min)) * (W - L - R);
  const Y = (v: number) => H - B - (v / yMax) * (H - B - T);
  const yTicks = [0, 1, 2, 3].map((i) => (yMax * i) / 3);
  const xTicks = compact ? [min, max] : [0, 1, 2, 3, 4, 5].map((i) => min + ((max - min) * i) / 5);
  const {floor, upside} = payoff(price, strike);
  const id = `hatch-${compact ? "c" : "w"}${terminal ? "t" : ""}`;
  const fmtTick = (v: number, first: boolean) => (terminal ? Math.round(v).toString() : compact && !first ? Math.round(v).toString() : `$${Math.round(v)}`);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width: "100%", height: "auto", display: "block"}} role="img"
         aria-label={`Line chart: Floor value rises with price until ${money(strike, 0)}, then stays flat. Upside is $0 until ${money(strike, 0)}, then rises with price. Marker at ${money(price)}: Floor ${money(floor)}, Upside ${money(upside)}.`}>
      <defs>
        <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="1.5" height="6" fill="var(--accent)" />
        </pattern>
      </defs>
      <path d={yTicks.map((v) => `M${L} ${Y(v)}H${W - R}`).join("")} stroke="var(--line)" strokeWidth="1" />
      <g fontFamily="var(--f-num), monospace" fontSize={fs} fill="var(--text-3)">
        {yTicks.map((v, i) => <text key={v} x={L - 10} y={Y(v) + 4} textAnchor="end">{fmtTick(v, i === 0)}</text>)}
        {xTicks.map((v, i) => (
          <text key={v} x={X(v)} y={H - 8} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>{terminal ? Math.round(v) : `$${Math.round(v)}`}</text>
        ))}
      </g>
      <path d={`M${X(strike)} ${Y(0)}L${X(max)} ${Y(max - strike)}L${X(max)} ${Y(0)}Z`} fill={`url(#${id})`} opacity=".55" />
      <path d={`M${X(min)} ${Y(0)}L${X(strike)} ${Y(0)}L${X(max)} ${Y(max - strike)}`} fill="none" stroke="var(--accent)" strokeWidth={compact ? 2 : 2.5} strokeDasharray={compact ? "6 4" : "8 5"} />
      <path d={`M${X(min)} ${Y(min)}L${X(strike)} ${Y(strike)}L${X(max)} ${Y(strike)}`} fill="none" stroke="var(--accent)" strokeWidth={compact ? 3.5 : 4} />
      <line x1={X(strike)} x2={X(strike)} y1={T} y2={Y(0)} stroke="var(--text)" strokeWidth="1.5" strokeDasharray="3 4" />
      {!compact && <text x={X(strike) + 8} y={T + 18} fontFamily="var(--f-num), monospace" fontSize={fs} fill="var(--text)">{label}</text>}
      {spot ? <line x1={X(spot)} x2={X(spot)} y1={Y(0) - 14} y2={Y(0)} stroke="var(--text-3)" strokeWidth="2" /> : null}
      <g style={{transition: "transform 120ms"}}>
        <line x1={X(price)} x2={X(price)} y1={T} y2={Y(0)} stroke="var(--accent-text)" strokeWidth="1.5" />
        <circle cx={X(price)} cy={Y(floor)} r={compact ? 5.5 : 7} fill="var(--accent-text)" stroke="var(--bg)" strokeWidth="2" />
        <circle cx={X(price)} cy={Y(upside)} r={compact ? 5.5 : 7} fill="var(--bg)" stroke="var(--accent-text)" strokeWidth={compact ? 2.5 : 3} />
      </g>
    </svg>
  );
}

/** The sun-handled slider. Drag the sun, or use the arrow keys. */
export function WhatIfTrack({strike, spot, price, setPrice, min, max, name, thin}: {
  strike: number; spot?: number; price: number; setPrice: (p: number) => void; min: number; max: number; name: string; thin?: boolean;
}) {
  const drag = useRef<HTMLElement | null>(null);
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const fromX = (el: HTMLElement, x: number) => {
    const r = el.getBoundingClientRect();
    setPrice(min + Math.max(0, Math.min(1, (x - r.left) / r.width)) * (max - min));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = {ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10};
    if (e.key in step) { e.preventDefault(); setPrice(price + step[e.key]); }
    else if (e.key === "Home") { e.preventDefault(); setPrice(min); }
    else if (e.key === "End") { e.preventDefault(); setPrice(max); }
  };
  const lineAt = pct(strike);

  return (
    <div role="slider" tabIndex={0} aria-label={`What if ${name} ends at this price`} aria-valuemin={min} aria-valuemax={max}
         aria-valuenow={price} aria-valuetext={money(price)}
         onPointerDown={(e) => { const el = e.currentTarget; try { el.setPointerCapture(e.pointerId); } catch {} drag.current = el; el.focus(); fromX(el, e.clientX); }}
         onPointerMove={(e) => { if (drag.current === e.currentTarget) fromX(e.currentTarget, e.clientX); }}
         onPointerUp={() => { drag.current = null; }}
         onKeyDown={onKey}
         className="whatif-track"
         style={{position: "relative", height: thin ? 40 : 64, cursor: thin ? "ew-resize" : "grab", touchAction: "none", outline: "none"}}>
      <div style={{position: "absolute", left: 0, right: 0, top: thin ? 19 : 31, height: 2, background: "var(--line)"}} />
      {!thin && <>
        <div style={{position: "absolute", left: 0, top: 30, height: 4, width: `${lineAt}%`, background: "var(--accent)"}} />
        <div style={{position: "absolute", left: `${lineAt}%`, right: 0, top: 29, height: 6, border: "1px solid var(--accent)", background: "repeating-linear-gradient(135deg,var(--accent) 0 1px,transparent 1px 5px)"}} />
      </>}
      <div style={{position: "absolute", left: `${lineAt}%`, top: thin ? 8 : 6, bottom: thin ? 8 : 6, width: thin ? 1 : 2, background: "var(--text)"}} />
      {spot && !thin ? (
        <div className="mono muted" style={{position: "absolute", left: `${pct(Math.max(min, Math.min(max, spot)))}%`, top: 44, fontSize: 11, transform: "translateX(-50%)", whiteSpace: "nowrap"}}>▲ TODAY</div>
      ) : null}
      <Relic src={RELIC.sunHandle} size={thin ? 32 : 48}
             style={{position: "absolute", top: thin ? 4 : 8, left: `${pct(price)}%`, transform: "translateX(-50%)", pointerEvents: "none", transition: drag.current ? "none" : "left 120ms var(--ease)"}} />
    </div>
  );
}

export function PresetChips({spot, price, setPrice, withSub = true}: {spot: number; price: number; setPrice: (p: number) => void; withSub?: boolean}) {
  if (!spot) return null;
  const presets: [string, number][] = [["Falls 30%", Math.round(spot * 0.7)], ["Stays flat", Math.round(spot)], ["Rises 30%", Math.round(spot * 1.3)]];
  return (
    <>
      {presets.map(([label, v]) => (
        <button key={label} className="chip" aria-pressed={price === v} onClick={() => setPrice(v)}>
          {label}{withSub && <span className="sub">${v}</span>}
        </button>
      ))}
    </>
  );
}

/** The two big numbers under the slider: what each piece would be worth, and the change. */
export function WorthPair({price, strike, floorToday, upsideToday, size = 48, compact}: {
  price: number; strike: number; floorToday: number; upsideToday: number; size?: number; compact?: boolean;
}) {
  const {floor, upside} = payoff(price, strike);
  const line = (d: number, base: number) => (Math.abs(d) < 0.005 ? "Same as today" : `${delta(d)} vs ${money(base)} today`);
  const cell = (relic: string, title: string, v: number, d: number, base: number, dashed?: boolean) => (
    <div style={{padding: compact ? 16 : 24, display: "flex", flexDirection: "column", gap: compact ? 8 : 10, background: "var(--surface)", border: dashed ? "1px dashed var(--accent)" : undefined}}>
      <div className="row gap-10">
        {!compact && <Relic src={relic} size={32} />}
        <span className="mono" style={{fontSize: compact ? 12 : 13, letterSpacing: ".08em"}}>{title}</span>
      </div>
      <div className="num gold" style={{fontSize: size, lineHeight: 1}}>{money(v)}</div>
      <div className={`mono ${d >= -0.005 ? "up" : "down"}`} style={{fontSize: compact ? 12 : 14, lineHeight: 1.3}}>
        {compact ? (Math.abs(d) < 0.005 ? "= today" : `${delta(d)} vs today`) : line(d, base)}
      </div>
    </div>
  );
  return (
    <div className="worth-pair" style={{display: "grid", gridTemplateColumns: "1fr 1fr", border: "1px solid var(--line)", gap: 1, background: "var(--line)"}}>
      {cell(RELIC.coinFloor, compact ? "FLOOR" : "YOUR FLOOR", floor, floor - floorToday, floorToday)}
      {cell(RELIC.coinUp, compact ? "UPSIDE" : "YOUR UPSIDE", upside, upside - upsideToday, upsideToday)}
    </div>
  );
}

export function ChartLegend() {
  return (
    <div className="row gap-20 mono" style={{fontSize: 12}}>
      <span className="row gap-8"><span style={{width: 24, height: 4, background: "var(--accent)"}} />FLOOR</span>
      <span className="row gap-8"><span style={{width: 24, height: 10, border: "1px solid var(--accent)", background: "repeating-linear-gradient(135deg,var(--accent) 0 1px,transparent 1px 4px)"}} />UPSIDE</span>
    </div>
  );
}
