"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import {money} from "@/lib/format";
import {C, brighter, coinFace, darker, hash, struckFace, type Col} from "@/lib/pixel";
import {play} from "@/lib/sound";
import {useReducedMotion} from "@/lib/ui";
import {BOLT, CHIP} from "./Emblem";
import {SunAnim} from "./Relic";

/**
 * The coin is the interface.
 *
 * One share, drawn as a pixel coin on a plinth, standing against a price ruler. The coin's height
 * IS the ruler's scale, so the price line on the ruler cuts the coin exactly where it falls:
 * everything above the line is the Upside, everything below is the Floor.
 *
 *   click a half        choose what you want (the Floor: earn cash; the Upside: bet on a rise)
 *   drag the line       move it along the ruler; it snaps to the lines that exist
 *   preview an ending   cells that would pay stay lit, cells that wouldn't go hollow
 *   striking            while a transaction is in flight the coin is hammered
 *
 * Each cell belongs wholly to one half, so the cut is pixel-exact at every frame.
 */

export type Half = "floor" | "upside";
export type Strike = {id: string; price: number};

const N = 64;            // the coin's grid, in cells
const GAP = 1.4;         // the split between the halves, in cells
const DRIFT = 2.4;       // how far the half you didn't pick drifts off

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

type Geo = {W: number; H: number; cs: number; D: number; x: number; y: number; ruler: number};

export function CoinStage({lo, hi, spot, strikes, selected, onSelect, half, onHalf, ending, striking, name, sym, floorPx, upsidePx}: {
  lo: number; hi: number; spot: number;
  strikes: Strike[]; selected?: string; onSelect: (id: string) => void;
  half: Half; onHalf: (h: Half) => void;
  ending: number | null; striking: boolean; name: string; sym: string;
  floorPx?: number; upsidePx?: number;
}) {
  const reduce = useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<Half | "line" | null>(null);
  // Each stock's coin is struck with its emblem: a chip for NVIDIA, a bolt for Tesla.
  const faces = useMemo(() => ({NVDA: struckFace(N, CHIP), TSLA: struckFace(N, BOLT), other: coinFace(N)} as Record<string, (Col | null)[]>), []);
  // The first time the app opens in a session, the coin arrives: it drops onto the plinth, then
  // the line slices it in two. After that it's simply there.
  const [arrive] = useState(() => {
    if (typeof window === "undefined") return false;
    try { if (sessionStorage.getItem("aarka.arrived")) return false; sessionStorage.setItem("aarka.arrived", "1"); } catch { return false; }
    return !matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  const K = strikes.find((s) => s.id === selected)?.price ?? strikes[0]?.price ?? spot;
  const nearest = (p: number) => strikes.reduce((a, b) => (Math.abs(b.price - p) < Math.abs(a.price - p) ? b : a), strikes[0]);
  const near = drag != null && strikes.length ? nearest(drag) : null;

  // Everything the animation loop reads, kept in a ref so the loop never restarts.
  const live = useRef({K, half, ending, striking, hover, drag, lo, hi, reduce, sym});
  live.current = {K, half, ending, striking, hover, drag, lo, hi, reduce, sym};

  // Layout: the coin fills the cstage's height, the ruler stands to its right.
  useEffect(() => {
    const el = wrap.current!;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const W = r.width, H = r.height;
      const narrow = W < 560;
      const rulerW = narrow ? 96 : 150;
      const room = Math.min(H - (narrow ? 104 : 150), (W - rulerW) * (narrow ? 0.86 : 0.74));
      const cs = Math.max(2, Math.floor(room / N));
      const D = cs * N;
      const x = Math.round((W - rulerW - D) / 2 + (narrow ? 4 : 0));
      const y = Math.round((H - D) / 2 + (narrow ? 2 : 6));
      setGeo({W, H, cs, D, x, y, ruler: x + D + (narrow ? 22 : 40)});
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const yOf = (p: number) => (geo ? geo.y + geo.D * (1 - (p - lo) / (hi - lo)) : 0);
  const priceAt = (clientY: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const p = lo + (1 - (clientY - r.top - geo!.y) / geo!.D) * (hi - lo);
    return Math.max(lo, Math.min(hi, p));
  };

  // Drawing.
  useEffect(() => {
    if (!geo) return;
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(geo.W * dpr);
    cv.height = Math.round(geo.H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const s = {cut: live.current.K, sel: live.current.half === "floor" ? 1 : 0, endA: 0, endP: spot, lift: 0, liftHalf: "floor" as Half};
    const sparks: {x: number; y: number; vx: number; vy: number; life: number; kind?: "note" | "dust"; seed?: number}[] = [];
    let intro0 = arrive ? -1 : -2, landed = false, sliced = false, lastHalf = live.current.half;
    let shown = live.current.sym, flip0 = -1; // switching stock flips the coin to its other face
    const bounce = (x: number) => { // ease-out bounce
      const n = 7.5625, d = 2.75;
      if (x < 1 / d) return n * x * x;
      if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
      if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
      return n * (x -= 2.625 / d) * x + 0.984375;
    };
    let raf = 0, last = 0, visible = true, shake = {x: 0, y: 0, t: 0};
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(cv);

    const draw = (t: number) => {
      const L = live.current;
      const k = L.reduce ? 1 : 0.16;
      s.cut = lerp(s.cut, L.drag ?? L.K, L.drag != null ? 0.5 : k);
      s.sel = lerp(s.sel, L.half === "floor" ? 1 : 0, k);
      s.endA = lerp(s.endA, L.ending != null ? 1 : 0, L.reduce ? 1 : 0.14);
      if (L.ending != null) s.endP = L.ending;
      const hv = L.hover === "floor" || L.hover === "upside" ? L.hover : null;
      if (hv) s.liftHalf = hv;
      s.lift = lerp(s.lift, hv ? 1 : 0, 0.2);

      const {cs, D, x: ox, y: oy} = geo;
      const span = L.hi - L.lo;
      const cutRow = (1 - (s.cut - L.lo) / span) * N;

      // The arrival: fall and bounce (0 to .42), rest whole, slice (.6), part (.6 to .85).
      let drop = 0, open = 1, flash = 0;
      if (intro0 !== -2) {
        if (intro0 < 0) intro0 = t;
        const p = (t - intro0) / 1800;
        drop = p < 0.42 ? (1 - bounce(p / 0.42)) * (oy + D + 60) : 0;
        open = p < 0.6 ? 0 : p < 0.85 ? 1 - Math.pow(1 - (p - 0.6) / 0.25, 3) : 1;
        flash = p > 0.58 && p < 0.78 ? 1 - Math.abs(p - 0.64) / 0.14 : 0;
        if (p >= 0.42 && !landed) {
          landed = true; play("clink");
          for (let i = 0; i < 22; i++) sparks.push({kind: "dust", x: ox + D * (0.2 + 0.6 * hash(i, 7)), y: oy + D + DRIFT * cs, vx: (hash(i, 8) - 0.5) * 7, vy: -0.6 - hash(i, 9) * 2.4, life: 1});
        }
        if (p >= 0.6 && !sliced) { sliced = true; play("crack"); }
        if (p >= 1) intro0 = -2;
      }

      // Changing your mind is felt: the Upside turns to cash (notes fly to the ticket), or lights up.
      if (L.half !== lastHalf && intro0 === -2) {
        lastHalf = L.half;
        const capY = oy + cutRow * cs * 0.55;
        if (L.half === "floor") {
          for (let i = 0; i < 14; i++) sparks.push({kind: "note", seed: i, x: ox + D * (0.25 + 0.5 * hash(t, i)), y: capY + (hash(i, t) - 0.5) * D * 0.2, vx: 2.5 + hash(t, i + 20) * 5, vy: -2.5 + hash(t, i + 40) * 2, life: 1});
        } else {
          for (let i = 0; i < 26; i++) { const a = hash(t, i) * Math.PI * 2; sparks.push({x: ox + D / 2 + Math.cos(a) * D * 0.3, y: capY + Math.sin(a) * D * 0.15, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3 - 2, life: 1}); }
        }
      }

      // The flip: the coin narrows to an edge, shows the new face, and widens again.
      let sx = 1;
      if (L.sym !== shown && flip0 < 0) { flip0 = L.reduce ? t - 999 : t; play("clink"); }
      if (flip0 >= 0) {
        const p = Math.min(1, (t - flip0) / 520);
        sx = Math.abs(Math.cos(Math.PI * p));
        if (p >= 0.5) shown = L.sym;
        if (p >= 1) flip0 = -1;
      }
      const face = faces[shown] ?? faces.other;
      const cx0 = ox + D / 2;

      const upOff = (-GAP / 2 - DRIFT * s.sel) * open - (s.liftHalf === "upside" ? 0.7 * s.lift : 0);
      const flOff = (GAP / 2 + DRIFT * (1 - s.sel)) * open - (s.liftHalf === "floor" ? 0.7 * s.lift : 0);

      if (L.striking && t - shake.t > 55) {
        shake = {x: (hash(t, 1) - 0.5) * cs * 1.6, y: (hash(t, 2) - 0.5) * cs * 1.6, t};
        for (let i = 0; i < 3; i++) {
          sparks.push({x: ox + hash(t, i + 3) * D, y: oy + cutRow * cs, vx: (hash(t, i + 9) - 0.5) * 5, vy: -1 - hash(t, i + 5) * 4, life: 1});
        }
      }
      if (!L.striking) shake = {x: shake.x * 0.6, y: shake.y * 0.6, t: shake.t};

      ctx.clearRect(0, 0, geo.W, geo.H);
      const sweep = L.reduce ? -999 : ((t % 6400) / 6400) * (2 * N + 40) - 20;

      for (let y = 0; y < N; y++) {
        const up = y + 0.5 < cutRow;
        const dim = (up ? s.sel : 1 - s.sel) * open;   // 0 = the half you picked, 1 = the other
        const pr = L.lo + (1 - (y + 0.5) / N) * span;  // the price this row stands for
        const off = up ? upOff : flOff;
        const py = oy + (y + off) * cs + shake.y - drop;
        for (let x = 0; x < N; x++) {
          let c = face[y * N + x];
          if (!c) continue;
          let a = 1 - 0.58 * dim;
          if (dim > 0.5) c = darker[c];
          // An ending, previewed: what would pay stays lit, what wouldn't goes hollow.
          if (s.endA > 0.01) {
            const paid = up ? pr <= s.endP : pr <= Math.min(s.endP, s.cut);
            if (!paid) {
              if ((x + y) % 2) { a *= 1 - s.endA; }
              else { c = "d" as Col; a *= 1 - 0.55 * s.endA; }
            }
          }
          const sw = x + y - sweep;
          if (dim < 0.5 && sw >= 0 && sw < 3) c = brighter[c];
          ctx.globalAlpha = a;
          ctx.fillStyle = C[c];
          const fx = cx0 + (x * cs - D / 2) * sx;
          ctx.fillRect(Math.round(fx + shake.x), py, Math.max(1, Math.ceil(cs * sx)), cs);
        }
      }
      ctx.globalAlpha = 1;

      // The line itself, carved across the coin and on to the ruler.
      const ly = Math.round(oy + cutRow * cs + (upOff + flOff) * cs / 2);
      ctx.save();
      ctx.shadowColor = "rgba(240, 180, 110, .8)";
      ctx.shadowBlur = 10 + 6 * Math.sin(t / 500);
      ctx.fillStyle = L.drag != null || L.hover === "line" ? "#F7E2BF" : "#F0B46E";
      ctx.fillRect(ox - 14, ly - 1, geo.ruler - ox + 14, 2);
      ctx.restore();

      if (flash > 0) {
        ctx.save();
        ctx.globalAlpha = flash;
        ctx.shadowColor = "#F7E2BF"; ctx.shadowBlur = 30;
        ctx.fillStyle = "#F7E2BF";
        ctx.fillRect(ox - 40, ly - 2, D + 80, 4);
        ctx.restore();
      }

      // The ending's price, as a dotted level across the coin.
      if (s.endA > 0.01) {
        const ey = Math.round(oy + (1 - (s.endP - L.lo) / span) * N * cs);
        ctx.globalAlpha = 0.85 * s.endA;
        ctx.fillStyle = "#F7E2BF";
        for (let x = ox - 10; x < geo.ruler; x += 6) ctx.fillRect(x, ey, 3, 1);
        ctx.globalAlpha = 1;
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        if (p.kind === "note") {
          // A pixel banknote, fluttering: its width swings to fake a turn in the air.
          p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.vy += 0.06; p.life -= 0.011;
          if (p.life <= 0) { sparks.splice(i, 1); continue; }
          const w = Math.max(cs, Math.round(cs * 5 * Math.abs(Math.cos(t / 140 + (p.seed ?? 0)))));
          const h = cs * 2.4;
          ctx.globalAlpha = Math.min(1, p.life * 1.6);
          ctx.fillStyle = "#1A2A25"; ctx.fillRect(Math.round(p.x - w / 2) - 1, Math.round(p.y) - 1, w + 2, h + 2);
          ctx.fillStyle = "#5E9E8A"; ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y), w, h);
          if (w > cs * 2) { ctx.fillStyle = "#B8E0D2"; ctx.fillRect(Math.round(p.x - cs / 2), Math.round(p.y + h / 2 - cs / 2), cs, cs); }
          continue;
        }
        if (p.kind === "dust") {
          p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy += 0.05; p.life -= 0.022;
          if (p.life <= 0) { sparks.splice(i, 1); continue; }
          ctx.globalAlpha = p.life * 0.8;
          ctx.fillStyle = p.life > 0.6 ? "#8C6A3F" : "#3A3024";
          ctx.fillRect(Math.round(p.x), Math.round(p.y), cs, cs);
          continue;
        }
        p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life -= 0.035;
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.life > 0.5 ? "#F7E2BF" : "#F0B46E";
        ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.max(2, cs / 2), Math.max(2, cs / 2));
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      if (visible && t - last > 30) { draw(t); last = t; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, [geo, faces, spot, arrive]);

  // Pointer on the coin: which half, or the line itself.
  const hit = (e: React.PointerEvent): Half | "line" | null => {
    if (!geo) return null;
    const r = wrap.current!.getBoundingClientRect();
    const cx = (e.clientX - r.left - geo.x) / geo.cs, cy = (e.clientY - r.top - geo.y) / geo.cs;
    const cutRow = (1 - (K - lo) / (hi - lo)) * N;
    if (Math.abs(cy - cutRow) < 1.8 && cx > -4 && cx < N + 2) return "line";
    if (Math.hypot(cx - N / 2, cy - N / 2) > N / 2 + 1) return null;
    return cy < cutRow ? "upside" : "floor";
  };

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    let cur = nearest(priceAt(e.clientY));
    setDrag(priceAt(e.clientY));
    const move = (ev: PointerEvent) => {
      const p = priceAt(ev.clientY);
      setDrag(p);
      const n = nearest(p);
      if (n.id !== cur.id) { cur = n; play("tick"); }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      onSelect(nearest(priceAt(ev.clientY)).id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sorted = [...strikes].sort((a, b) => a.price - b.price);
  const step = (dir: 1 | -1) => {
    const i = sorted.findIndex((s) => s.id === selected);
    const n = sorted[Math.max(0, Math.min(sorted.length - 1, i + dir))];
    if (n && n.id !== selected) { onSelect(n.id); play("tick"); }
  };

  const tickStep = (() => {
    const raw = (hi - lo) / 6;
    return [5, 10, 20, 25, 50, 100].find((v) => v >= raw) ?? 100;
  })();
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep) ticks.push(v);
  const handleP = drag ?? K;

  return (
    <div ref={wrap} className={`cstage${striking ? " striking" : ""}${arrive ? " arrive" : ""}`}
         onPointerMove={(e) => { if (drag == null) setHover(hit(e)); }}
         onPointerLeave={() => setHover(null)}>
      <div className="cstage-light" aria-hidden />
      <canvas ref={canvas} className="cstage-canvas" aria-hidden
              style={{cursor: hover === "line" ? "ns-resize" : hover ? "pointer" : "default"}}
              onPointerDown={(e) => {
                const h = hit(e);
                if (h === "line") startDrag(e);
                else if (h && h !== half) { onHalf(h); play("clink"); }
              }} />
      {geo && (
        <>
          <div className="cstage-plinth" aria-hidden style={{left: geo.x + geo.D * 0.08, width: geo.D * 0.84, top: geo.y + geo.D + DRIFT * geo.cs + 10}} />

          {/* The two halves, as buttons too: for keyboards, screen readers and anyone who'd rather read. */}
          <button className={`cstage-half up${half === "upside" ? " on" : ""}${hover === "upside" ? " hot" : ""}`}
                  style={{left: geo.x, top: Math.max(4, geo.y - DRIFT * geo.cs - 50)}}
                  aria-pressed={half === "upside"} onClick={() => { onHalf("upside"); play("clink"); }}>
            <span className="k">UPSIDE{upsidePx ? ` · ${money(upsidePx)}` : ""}</span>
            <span className="t">Bet on a rise</span>
          </button>
          <button className={`cstage-half fl${half === "floor" ? " on" : ""}${hover === "floor" ? " hot" : ""}`}
                  style={{left: geo.x, top: geo.y + geo.D + DRIFT * geo.cs + 22}}
                  aria-pressed={half === "floor"} onClick={() => { onHalf("floor"); play("clink"); }}>
            <span className="k">FLOOR{floorPx ? ` · ${money(floorPx)}` : ""}</span>
            <span className="t">Earn cash on my shares</span>
          </button>

          <div className="ruler" style={{left: geo.ruler, top: geo.y, height: geo.D}}
               onPointerDown={(e) => { if ((e.target as HTMLElement).closest(".notch")) return; startDrag(e); }}>
            <span className="ruler-bar" aria-hidden />
            {ticks.map((v) => (
              <span key={v} className="ruler-tick" aria-hidden style={{top: yOf(v) - geo.y}}><i />{v}</span>
            ))}
            {spot > 0 && (
              <span className="ruler-spot" style={{top: yOf(spot) - geo.y}} aria-label={`${name} today, ${money(spot)}`}>
                <SunAnim size={22} /><b>TODAY</b>{money(spot)}
              </span>
            )}
            {ending != null && (
              <span className="ruler-end" style={{top: yOf(ending) - geo.y}} aria-hidden>IF {money(ending, 0)}</span>
            )}
            {strikes.map((s) => (
              <button key={s.id} className={`notch${s.id === selected ? " on" : ""}${near?.id === s.id ? " near" : ""}`}
                      style={{top: yOf(s.price) - geo.y}} onClick={() => { onSelect(s.id); play("tick"); }}
                      aria-label={`Line at ${money(s.price, 0)}`} aria-pressed={s.id === selected}>
                ${Math.round(s.price)}
              </button>
            ))}
            <span className={`ruler-grip${drag != null ? " dragging" : ""}`} role="slider" tabIndex={0}
                  aria-label="The price line" aria-valuemin={Math.round(lo)} aria-valuemax={Math.round(hi)} aria-valuenow={Math.round(K)}
                  aria-valuetext={`Line at ${money(K, 0)}`}
                  style={{top: yOf(handleP) - geo.y, transition: drag != null || reduce ? "none" : undefined}}
                  onPointerDown={(e) => { e.stopPropagation(); startDrag(e); }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); step(1); }
                    if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
                  }}>
              <i /><i /><i />
            </span>
          </div>
          {strikes.length > 1 && <span className="cstage-hint" aria-hidden style={{left: geo.ruler - 6, top: geo.y + geo.D + 14}}>DRAG THE LINE ↕</span>}
        </>
      )}
    </div>
  );
}
