"use client";

import {AnimatePresence, motion, useSpring, useTransform} from "motion/react";
import {useEffect, useMemo, useRef, useState} from "react";
import {ADDRESSES} from "@/lib/contracts";
import {pickFeatured, quoteFor, useParityAll, useRounds, useSeries} from "@/lib/data";
import {money, n8} from "@/lib/format";
import {C, coinFace, type Col} from "@/lib/pixel";
import {RELIC} from "@/lib/relics";
import {play} from "@/lib/sound";
import {useReducedMotion} from "@/lib/ui";
import {Relic, SunAnim} from "../Relic";
import {CHAMBERS, type Chamber as Id} from "./terms";

/**
 * A deep dive: one mechanic as an object you can turn over. Everything is CSS 3D: coins are
 * "sprite stacks" (the pixel face repeated as thin slices along the depth), so they turn like
 * voxel objects and stay pixel art from every angle. No 3D library, nothing to download.
 *
 * Three layers on every chamber: STORY in plain words, NUMBERS with a live or worked example,
 * BUILDER with the exact rule and the contract call.
 */

type Layer = "story" | "numbers" | "builder";

export function ChamberView({id, onClose}: {id: Id | null; onClose: () => void}) {
  const [layer, setLayer] = useState<Layer>("story");
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!id) return;
    setLayer("story");
    play("clink");
    const t = setTimeout(() => close.current?.focus(), 200);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => { clearTimeout(t); window.removeEventListener("keydown", esc); html.style.overflow = prev; };
  }, [id, onClose]);

  return (
    <AnimatePresence>
      {id && (
        <motion.div className="chamber" role="dialog" aria-modal="true" aria-labelledby="chamber-h" data-lenis-prevent
                    initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.3}}>
          <motion.div className="chamber-in" initial={{scale: 0.97, y: 16}} animate={{scale: 1, y: 0}} exit={{scale: 0.98, opacity: 0}} transition={{type: "spring", stiffness: 260, damping: 28}}>
            <header className="chamber-head">
              <div className="stack" style={{gap: 6}}>
                <span className="kicker">DEEP DIVE · {CHAMBERS[id].kicker}</span>
                <h2 id="chamber-h" className="display" style={{fontSize: "clamp(28px, 3.4vw, 48px)", lineHeight: 1}}>{CHAMBERS[id].title}</h2>
              </div>
              <div className="layers" role="tablist" aria-label="Layer">
                {(["story", "numbers", "builder"] as const).map((l) => (
                  <button key={l} role="tab" aria-selected={layer === l} className={layer === l ? "on" : ""} onClick={() => { setLayer(l); play("tick"); }}>{l.toUpperCase()}</button>
                ))}
              </div>
              <button ref={close} className="chamber-x" onClick={onClose} aria-label="Close the deep dive">ESC ✕</button>
            </header>
            {id === "coin" && <CoinChamber layer={layer} />}
            {id === "sun" && <SunChamber layer={layer} />}
            {id === "scales" && <ScalesChamber layer={layer} />}
            {id === "timeline" && <TimelineChamber layer={layer} />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Shared: orbit and sprite stacks ──────────────────────────────────────────────────────────

/** Drag to turn. When left alone it spins (or sways) slowly, unless motion is reduced. */
function useOrbit(el: React.RefObject<HTMLDivElement | null>, {rx = -16, ry = 28, auto = "spin" as "spin" | "sway" | "none", clampX = [-70, 70] as [number, number], base = ""} = {}) {
  const reduce = useReducedMotion();
  const o = useRef({rx, ry, vx: 0, vy: 0, drag: false, last: 0, px: 0, py: 0});
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const s = o.current;
      if (!s.drag) {
        s.ry += s.vy; s.rx += s.vx; s.vx *= 0.92; s.vy *= 0.92;
        if (!reduce && t - s.last > 2200) {
          if (auto === "spin") s.ry += 0.18;
          if (auto === "sway") s.ry += (ry + Math.sin((t - t0) / 1800) * 16 - s.ry) * 0.02;
        }
      }
      s.rx = Math.max(clampX[0], Math.min(clampX[1], s.rx));
      if (el.current) el.current.style.transform = `${base} rotateX(${s.rx}deg) rotateY(${s.ry}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [el, reduce, auto, ry, clampX, base]);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      const s = o.current; s.drag = true; s.px = e.clientX; s.py = e.clientY; s.last = performance.now();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = o.current; if (!s.drag) return;
      const dx = e.clientX - s.px, dy = e.clientY - s.py;
      s.ry += dx * 0.45; s.rx -= dy * 0.35; s.vy = dx * 0.12; s.vx = -dy * 0.08;
      s.px = e.clientX; s.py = e.clientY; s.last = performance.now();
    },
    onPointerUp: () => { o.current.drag = false; o.current.last = performance.now(); },
  };
}

/** A pixel texture as a data URL: one colour per cell, or transparent. */
function texture(cells: (Col | null)[], n: number, alpha?: (i: number) => number) {
  const cv = document.createElement("canvas");
  cv.width = n; cv.height = n;
  const x = cv.getContext("2d")!;
  cells.forEach((c, i) => {
    if (!c) return;
    x.globalAlpha = alpha ? alpha(i) : 1;
    x.fillStyle = C[c];
    x.fillRect(i % n, Math.floor(i / n), 1, 1);
  });
  return cv.toDataURL();
}

/** A sprite stack: the face on the front and back, the edge colour in between. */
function Stack({face, edge, size, depth = 24, slices = 12, style}: {face: string; edge: string; size: number; depth?: number; slices?: number; style?: React.CSSProperties}) {
  return (
    <div className="stack3d" style={{width: size, height: size, ...style}}>
      {Array.from({length: slices}, (_, i) => {
        const z = -depth / 2 + (depth * i) / (slices - 1);
        const end = i === 0 || i === slices - 1;
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={i} src={end ? face : edge} alt="" width={size} height={size} style={{transform: `translateZ(${z}px)${i === 0 ? " rotateY(180deg)" : ""}`}} />;
      })}
    </div>
  );
}

function Viewport({children, bind, hint = "DRAG TO TURN"}: {children: React.ReactNode; bind: ReturnType<typeof useOrbit>; hint?: string}) {
  return (
    <div className="viewport" {...bind}>
      <div className="viewport-light" aria-hidden />
      {children}
      <span className="viewport-hint mono" aria-hidden>{hint} ⟲</span>
    </div>
  );
}

function Panel({layer, story, numbers, builder}: {layer: Layer; story: React.ReactNode; numbers: React.ReactNode; builder: React.ReactNode}) {
  return (
    <div className="chamber-panel">
      <AnimatePresence mode="wait">
        <motion.div key={layer} initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -8}} transition={{duration: 0.2}} className="stack" style={{gap: 14}}>
          {layer === "story" ? story : layer === "numbers" ? numbers : builder}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Code({children}: {children: string}) {
  const [ok, setOk] = useState(false);
  return (
    <div className="code-card">
      <button className="mono" onClick={() => { navigator.clipboard?.writeText(children).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1400); }}>{ok ? "COPIED" : "COPY"}</button>
      <pre>{children}</pre>
    </div>
  );
}

/** The example every chamber uses: the featured live split, or a fixed one while it loads. */
function useExample() {
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const s = pickFeatured(rows);
  const q = s ? quoteFor(s, parity) : undefined;
  return {s, q, parity, K: q?.strike ?? 210, spot: q?.spot ?? 201.4, live: !!q};
}

// ── The coin ─────────────────────────────────────────────────────────────────────────────────

const CN = 32;

function CoinChamber({layer}: {layer: Layer}) {
  const {K, spot, q, live} = useExample();
  const lo = K * 0.55, hi = K * 1.6;
  const [P, setP] = useState(Math.round(spot * 1.25));
  const [apart, setApart] = useState(0.6);
  const scene = useRef<HTMLDivElement>(null);
  const bind = useOrbit(scene, {rx: -12, ry: 32, auto: "none"});
  const size = 220;
  const cs = size / CN;
  const cutRow = (1 - (K - lo) / (hi - lo)) * CN;
  const face = useMemo(() => coinFace(CN), []);

  const tex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const part = (up: boolean, edge: boolean) => {
      const cells = face.map((c, i) => {
        const y = Math.floor(i / CN);
        if (!c || (y + 0.5 < cutRow) !== up) return null;
        return edge ? ((i % CN + y) % 3 === 0 ? "d" : "z") as Col : c;
      });
      // On the face: what would pay stays lit, what wouldn't goes hollow.
      return texture(cells, CN, edge ? undefined : (i) => {
        const pr = lo + (1 - (Math.floor(i / CN) + 0.5) / CN) * (hi - lo);
        const paid = up ? pr <= P : pr <= Math.min(P, K);
        return paid ? 1 : ((i % CN + Math.floor(i / CN)) % 2 ? 0.08 : 0.4);
      });
    };
    return {upF: part(true, false), upE: part(true, true), flF: part(false, false), flE: part(false, true)};
  }, [face, cutRow, P, K, lo, hi]);

  const gap = apart * 46;
  const floorPays = Math.min(P, K), upPays = Math.max(P - K, 0);

  return (
    <div className="chamber-body">
      <div className="chamber-stage">
        <Viewport bind={bind}>
          <div className="scene" ref={scene}>
            {tex && (
              <>
                <Stack face={tex.upF} edge={tex.upE} size={size} style={{transform: `translateY(${-gap / 2}px)`}} />
                <Stack face={tex.flF} edge={tex.flE} size={size} style={{transform: `translateY(${gap / 2}px)`}} />
                <div className="cut-plane" style={{transform: `translateY(${cutRow * cs - size / 2}px) rotateX(90deg)`}} />
                <span className="tag3d up" style={{transform: `translate3d(${size / 2 + 18}px, ${-size / 4 - gap / 2}px, 30px)`}}>UPSIDE<b>{money(upPays)}</b></span>
                <span className="tag3d fl" style={{transform: `translate3d(${size / 2 + 18}px, ${size / 4 + gap / 2}px, 30px)`}}>FLOOR<b>{money(floorPays)}</b></span>
              </>
            )}
          </div>
        </Viewport>
        <div className="chamber-controls">
          <label className="ctl">
            <span>IF IT ENDS AT <b className="gold">{money(P, 0)}</b></span>
            <input type="range" min={Math.round(lo)} max={Math.round(hi)} value={P} onChange={(e) => setP(+e.target.value)} />
          </label>
          <label className="ctl">
            <span>{apart < 0.08 ? "PUT BACK TOGETHER" : "SPLIT APART"}</span>
            <input type="range" min={0} max={1} step={0.01} value={apart} onChange={(e) => setApart(+e.target.value)} />
          </label>
        </div>
      </div>
      <Panel layer={layer}
        story={<>
          <p className="lead" style={{fontSize: 19}}>A share is cut at the line, <b className="gold">{money(K, 0)}</b>. The bottom is the Floor; the top is the Upside.</p>
          <p className="body">Slide the ending price. What stays lit is what gets paid. Below the line the Floor takes everything and the Upside goes dark. Above it, the Floor stops at {money(K, 0)} and the Upside takes the rest.</p>
          <p className="body">Close the gap and the two halves are one share again. That works at any moment, even after the end date.</p>
        </>}
        numbers={<>
          <span className="label">{live ? "LIVE EXAMPLE · " + (q ? `TODAY ${money(spot)}` : "") : "WORKED EXAMPLE"}</span>
          <table className="num-table"><tbody>
            <tr><td>Line (K)</td><td>{money(K)}</td></tr>
            <tr><td>Ending price (P)</td><td>{money(P)}</td></tr>
            <tr><td>Floor pays min(P, K)</td><td className="gold">{money(floorPays)}</td></tr>
            <tr><td>Upside pays max(P − K, 0)</td><td className="gold">{money(upPays)}</td></tr>
            <tr className="sum"><td>Together</td><td>{money(floorPays + upPays)} = P</td></tr>
          </tbody></table>
          {q && <p className="small muted">Today the Floor trades at {money(q.floor)} and the Upside at {money(q.upside)}{q.source === "market" ? ", from their pools" : ", a labelled estimate"}.</p>}
        </>}
        builder={<>
          <p className="small">Payouts are in the share token, so the protocol never needs dollars. Per piece, at final price P:</p>
          <Code>{`floor  = min(P, K) / P   // share tokens per Floor
upside = max(P - K, 0) / P   // share tokens per Upside
floor + upside == 1          // always one share`}</Code>
          <Code>{`series.mint(amount, to)    // 1 share -> 1 Floor + 1 Upside
series.redeem(amount, to)  // 1 Floor + 1 Upside -> 1 share
                           // never paused, never gated on time`}</Code>
        </>}
      />
    </div>
  );
}

// ── The Sun ──────────────────────────────────────────────────────────────────────────────────

const DAY = 86400;

function SunChamber({layer}: {layer: Layer}) {
  const {data: rounds} = useRounds(ADDRESSES.feed as `0x${string}`, 8);
  const live = !!rounds?.length;
  // A phone shows the last five rounds, big enough to read; a wide screen shows all eight.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => { const m = matchMedia("(max-width: 720px)"); setNarrow(m.matches); const on = () => setNarrow(m.matches); m.addEventListener("change", on); return () => m.removeEventListener("change", on); }, []);
  const rs = useMemo(() => {
    if (rounds?.length) return [...rounds].sort((a, b) => a.at - b.at).slice(narrow ? -5 : 0);
    const now = Math.floor(Date.now() / 1000);
    return [5, 4, 3, 2, 1, 0].map((d, i) => ({id: BigInt(100 + i), price: 228 + Math.sin(i * 1.7) * 6, at: now - d * DAY}));
  }, [rounds, narrow]);
  const t0 = rs[0].at, t1 = rs[rs.length - 1].at;
  const span = Math.max(1, t1 - t0);
  const [end, setEnd] = useState<number | null>(null);
  const endT = end ?? Math.round(t0 + span * 0.62);
  const chosen = [...rs].reverse().find((r) => r.at <= endT);
  const stale = chosen && endT - chosen.at > 26 * 3600;
  // Rounds stand evenly spaced, in time order, so they never pile up; the end time sits between
  // the two rounds it falls between.
  const slot = 440 / Math.max(1, rs.length);
  const xi = (i: number) => -220 + slot * (i + 0.5);
  const X = (t: number) => {
    const k = rs.findIndex((r) => r.at > t);
    if (k === 0) return xi(0) - slot / 2;
    if (k < 0) return xi(rs.length - 1) + slot / 2;
    const a = rs[k - 1], b = rs[k];
    return xi(k - 1) + ((t - a.at) / Math.max(1, b.at - a.at)) * slot;
  };
  const scene = useRef<HTMLDivElement>(null);
  const bind = useOrbit(scene, {rx: 0, ry: -8, auto: "none", clampX: [-12, 18]});
  const fmt = (t: number) => new Date(t * 1000).toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});

  return (
    <div className="chamber-body">
      <div className="chamber-stage">
        <Viewport bind={bind} hint="DRAG TO LOOK AROUND">
          <div className="sun-above" aria-hidden><SunAnim size={88} /></div>
          <div className="scene" ref={scene}>
            <div className="floor3d">
              <span className="axis" />
              {rs.map((r) => {
                const on = chosen?.id === r.id;
                const after = r.at > endT;
                return (
                  <div key={r.id.toString()} className={`tablet3d${on ? " on" : ""}${after ? " after" : ""}`}
                       style={{transform: `translate3d(${xi(rs.indexOf(r))}px, 0, ${on ? 26 : 0}px) rotateX(-90deg)`}}>
                    <b>{money(r.price)}</b><small>{fmt(r.at)}</small>
                  </div>
                );
              })}
              <div className="end3d" style={{transform: `translate3d(${X(endT)}px, 0, 0) rotateX(-90deg)`}}><span>END TIME</span></div>
              {chosen && <div className="beam3d" style={{transform: `translate3d(${xi(rs.indexOf(chosen))}px, 0, 0) rotateX(-90deg)`}} />}
            </div>
          </div>
        </Viewport>
        <div className="chamber-controls">
          <label className="ctl">
            <span>MOVE THE END TIME · <b className="gold">{fmt(endT)}</b></span>
            <input type="range" min={t0 - span * 0.05} max={t1 + span * 0.1} value={endT} onChange={(e) => setEnd(+e.target.value)} />
          </label>
          <span className="mono small" style={{color: chosen && !stale ? "var(--up)" : "var(--down)"}}>
            {!chosen ? "No price yet at this time. The split would wait." : stale ? `Last price is ${Math.round((endT - chosen.at) / 3600)}h old. Too old: the split waits (a week later, it's accepted at any age).` : `Final price: ${money(chosen.price)}, published ${fmt(chosen.at)}.`}
          </span>
        </div>
      </div>
      <Panel layer={layer}
        story={<>
          <p className="lead" style={{fontSize: 19}}>The Sun publishes a price whenever the stock moves, and at least once a day. Each one is a tablet on the timeline.</p>
          <p className="body">The final price is the <b>last tablet standing at or before the end time</b>. Slide the end time and watch which one rises.</p>
          <p className="body">Nobody picks it. Anyone can send it in, and the contract checks it is the right one, so the result is the same whoever does.</p>
        </>}
        numbers={<>
          <span className="label">{live ? "LIVE · THE LAST ROUNDS OF NVDA/USD" : "EXAMPLE ROUNDS"}</span>
          <table className="num-table"><tbody>
            {[...rs].reverse().map((r) => (
              <tr key={r.id.toString()} className={chosen?.id === r.id ? "hl" : ""}><td>#{r.id.toString().slice(-6)} · {fmt(r.at)}</td><td>{money(r.price)}</td></tr>
            ))}
          </tbody></table>
        </>}
        builder={<>
          <Code>{`settle(roundId)              // anyone, once expiry has passed
  round.updatedAt <= expiry
  no later round at or before expiry
  expiry - round.updatedAt <= MAX_SETTLEMENT_AGE (26h)
  sequencer up, no corporate action since the round
  // after LATE_SETTLEMENT_DELAY (7 days): only the
  // round pinning is required, any age is accepted`}</Code>
          <p className="small">Feed: Chainlink {`NVDA/USD`} at <code className="gold">{ADDRESSES.feed.slice(0, 10)}…</code>. No admin key can set or override a price.</p>
        </>}
      />
    </div>
  );
}

// ── The Scales ───────────────────────────────────────────────────────────────────────────────

function ScalesChamber({layer}: {layer: Layer}) {
  const {s, q, parity} = useExample();
  const p = s ? parity?.[s.series.toLowerCase()] : undefined;
  const tilt = useSpring(0, {stiffness: 60, damping: 9});
  const L = 150;
  const leftY = useTransform(tilt, (t) => Math.sin((t * Math.PI) / 180) * -L);
  const rightY = useTransform(tilt, (t) => Math.sin((t * Math.PI) / 180) * L);
  const beam = useTransform(tilt, (t) => `rotateZ(${t}deg)`);
  const [msg, setMsg] = useState("Balanced: Floor + Upside = one share.");
  const scene = useRef<HTMLDivElement>(null);
  const bind = useOrbit(scene, {rx: -8, ry: -18, auto: "none", clampX: [-30, 30]});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const push = (dir: 1 | -1) => {
    clearTimeout(timer.current);
    tilt.set(dir * 16);
    play("clink");
    setMsg(dir > 0 ? "Someone bought Upsides: Floor + Upside now costs more than a share." : "Someone sold Floors: Floor + Upside now costs less than a share.");
    timer.current = setTimeout(() => {
      tilt.set(0);
      play("chime");
      setMsg(dir > 0 ? "The Scales acted: bought a share, split it, sold both halves. Balanced again; the profit went to the pools." : "The Scales acted: bought both halves, put them back together, sold the share. Balanced again; the profit went to the pools.");
    }, 1300);
  };

  return (
    <div className="chamber-body">
      <div className="chamber-stage">
        <Viewport bind={bind} hint="DRAG TO LOOK AROUND">
          <div className="scene" ref={scene}>
            <div className="post3d" />
            <div className="base3d" />
            <motion.div className="beam3d" style={{transform: beam}} />
            <motion.div className="pan3d" style={{x: -L, y: leftY}}>
              <span className="chain" />
              <div className="pan-dish"><Relic src={RELIC.coinFloor} size={44} /><Relic src={RELIC.coinUp} size={44} /></div>
              <span className="pan-tag">FLOOR + UPSIDE</span>
            </motion.div>
            <motion.div className="pan3d" style={{x: L, y: rightY}}>
              <span className="chain" />
              <div className="pan-dish"><Relic src={RELIC.coinFull} size={52} /></div>
              <span className="pan-tag">ONE SHARE</span>
            </motion.div>
          </div>
        </Viewport>
        <div className="chamber-controls">
          <div className="row gap-8 wrap-row">
            <button className="btn btn-secondary btn-sm" onClick={() => push(1)}>Someone buys Upsides</button>
            <button className="btn btn-secondary btn-sm" onClick={() => push(-1)}>Someone sells Floors</button>
          </div>
          <span className="small" aria-live="polite">{msg}</span>
        </div>
      </div>
      <Panel layer={layer}
        story={<>
          <p className="lead" style={{fontSize: 19}}>A Floor and an Upside always make exactly one share. So their prices should add up to one share&apos;s price.</p>
          <p className="body">When trading pushes them apart, The Scales trade the gap away in the same transaction: split a share and sell the halves, or buy the halves and put them back together. Push the scales and watch.</p>
          <p className="body">It can do this without guessing at any price, because splitting and putting back together are exact, one for one, always.</p>
        </>}
        numbers={<>
          <span className="label">{p ? "LIVE · " + (s ? `${s.underlyingSymbol} $${Math.round(n8(s.strike))}` : "") : "WAITING FOR POOLS"}</span>
          {q && p ? (
            <table className="num-table"><tbody>
              <tr><td>Floor, from its pool</td><td>{money(q.floor)}</td></tr>
              <tr><td>Upside, from its pool</td><td>{money(q.upside)}</td></tr>
              <tr className="sum"><td>Floor + Upside</td><td className="gold">{money(q.floor + q.upside)}</td></tr>
              <tr><td>One share</td><td>{money(q.spot)}</td></tr>
              <tr><td>Gap</td><td>{(Number(p.gapBps) / 100).toFixed(2)}%</td></tr>
              <tr><td>Acts above</td><td>{(Number(p.minDeviationBps) / 100).toFixed(2)}%</td></tr>
            </tbody></table>
          ) : <p className="small muted">Live pool prices appear here once they load.</p>}
        </>}
        builder={<>
          <p className="small">AarkaParityHook, in <code>afterSwap</code>, across three pools quoted in the same currency:</p>
          <Code>{`sum too high -> buy share in P1, mint at the series,
                sell Floor in P2 and Upside in P3
sum too low  -> buy Floor and Upside, redeem at the series,
                sell share in P1
// inside the PoolManager lock: flash accounting, no capital
// the profit is donated to the pools' liquidity providers`}</Code>
        </>}
      />
    </div>
  );
}

// ── From the end time to your payout ─────────────────────────────────────────────────────────

/**
 * Not a 3D object: a timeline you scrub, or play. The point is the order of things and what you
 * can do at each moment, so it stays flat and readable.
 */
const STEPS = [
  {at: 0, t: "Open", d: "Before the end time. Split, buy, sell, put back together.", relic: RELIC.astro(0.3)},
  {at: 22, t: "The end time", d: "4:00 pm New York time on the end date. No new splits after it.", relic: RELIC.astro(0.95)},
  {at: 38, t: "Price carved", d: "Anyone sends in The Sun's last price at or before the end. The contract checks it.", relic: RELIC.stele},
  {at: 82, t: "Collect", d: "The window has closed. Floors and Upsides pay out in the share token. No deadline.", relic: RELIC.coinFull},
];
const WIN = [38, 82] as const;     // the one-hour window, on the track
const FIX = 62;                    // where a later round replaces the carved one

function TimelineChamber({layer}: {layer: Layer}) {
  const reduce = useReducedMotion();
  const [s, setS] = useState(30);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now(), from = s >= 99 ? 0 : s;
    const tick = (t: number) => {
      const v = Math.min(100, from + ((t - t0) / 7000) * 100);
      setS(v);
      if (v < 100) raf = requestAnimationFrame(tick); else setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = s < STEPS[1].at ? 0 : s < WIN[0] ? 1 : s < WIN[1] ? 2 : 3;
  const STATUS = ["OPEN", "EXPIRED", "CHALLENGING", "CLAIMABLE"];
  const inWin = status === 2;
  const minsLeft = Math.ceil(60 * (1 - (s - WIN[0]) / (WIN[1] - WIN[0])));
  const fixed = s >= FIX;
  const can = [
    {t: "Split", on: status === 0},
    {t: "Put back together", on: true},
    {t: "Correct the price", on: inWin},
    {t: "Collect", on: status === 3},
  ];

  return (
    <div className="chamber-body">
      <div className="chamber-stage">
        <div className="tl">
          <div className="tl-statuses" aria-label="Status">
            {STATUS.map((x, i) => <span key={x} className={i === status ? "on" : i < status ? "past" : ""}>{x}</span>)}
          </div>

          <div className="tl-track-wrap">
            {STEPS.map((st) => (
              <div key={st.t} className={`tl-station${s >= st.at ? " reached" : ""}`} style={{left: `${st.at}%`}}>
                <Relic src={st.relic} size={40} />
                <span>{st.t}</span>
              </div>
            ))}
            <div className="tl-window" style={{left: `${WIN[0]}%`, width: `${WIN[1] - WIN[0]}%`}}><span>ONE HOUR TO CORRECT</span></div>
            <div className="tl-track"><span className="tl-fill" style={{width: `${s}%`}} /></div>
            <div className="tl-now" style={{left: `${s}%`}} aria-hidden><SunAnim size={28} /></div>
          </div>

          <div className="tl-state">
            <div className="tl-price">
              <span className="label">FINAL PRICE</span>
              {status < 2 ? <b className="num muted">not set yet</b> : (
                <AnimatePresence mode="wait">
                  <motion.b key={fixed ? "b" : "a"} className="num gold" initial={reduce ? false : {opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -6}}>
                    {fixed ? "$234.10" : "$233.26"}
                  </motion.b>
                </AnimatePresence>
              )}
              <span className="small muted">
                {status < 2 ? "Waiting for anyone to carve The Sun's price." : fixed ? "Corrected to a later round, still before the end. (Example.)" : "Carved from The Sun's last round before the end. (Example.)"}
              </span>
            </div>
            <div className="tl-clock">
              <span className="label">{inWin ? "WINDOW CLOSES IN" : status === 3 ? "WINDOW" : "WINDOW OPENS"}</span>
              <b className="num">{inWin ? `${minsLeft} min` : status === 3 ? "closed" : "when the price is carved"}</b>
            </div>
          </div>

          <div className="tl-can">
            <span className="label">WHAT YOU CAN DO NOW</span>
            <div className="row gap-8 wrap-row">{can.map((c) => <span key={c.t} className={`tl-chip${c.on ? " on" : ""}`}>{c.on ? "✓" : "–"} {c.t}</span>)}</div>
          </div>
        </div>
        <div className="chamber-controls">
          <div className="row gap-12" style={{alignItems: "center"}}>
            <button className="btn btn-secondary btn-sm" onClick={() => setPlaying(!playing)}>{playing ? "Pause" : s >= 99 ? "Replay" : "Play it"}</button>
            <input type="range" min={0} max={100} step={0.5} value={s} onChange={(e) => { setPlaying(false); setS(+e.target.value); }} aria-label="Time" style={{flex: 1, accentColor: "#D9924A"}} />
          </div>
        </div>
      </div>
      <Panel layer={layer}
        story={<>
          <p className="lead" style={{fontSize: 19}}>Four moments, and you only have to act on the last one.</p>
          {STEPS.map((p, i) => <p key={p.t} className="body"><b>{["I", "II", "III", "IV"][i]}. {p.t}.</b> {p.d}</p>)}
          <p className="body">Between the carving and collecting there&apos;s one hour in which anyone may swap the price for a later round the rules allow. It can only move closer to the end time, never further.</p>
        </>}
        numbers={<>
          <table className="num-table"><tbody>
            <tr><td>Freshness</td><td>price ≤ 26 hours old</td></tr>
            <tr><td>Correction window</td><td>1 hour, never extended</td></tr>
            <tr><td>If The Sun is quiet</td><td>any age, after 7 days</td></tr>
            <tr><td>Collect deadline</td><td>none</td></tr>
            <tr><td>Put back together</td><td>always open</td></tr>
          </tbody></table>
        </>}
        builder={<>
          <Code>{`status: Open -> Expired -> Challenging -> Claimable
settle(roundId)                     // anyone, after expiry
challengeSettlement(betterRoundId)  // anyone, within 1 hour;
                                    // strictly later, still <= expiry
claimsUnlockAt()                    // settled at + CHALLENGE_PERIOD (1h)
claimFloor(amount, to)              // once claims unlock
claimUpside(amount, to)
redeem(amount, to)                  // any status, never paused`}</Code>
        </>}
      />
    </div>
  );
}
