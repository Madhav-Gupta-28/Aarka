"use client";

import {play} from "@/lib/sound";
import {TeleportLink} from "./Teleport";
import {useEffect, useRef, useState} from "react";
import {AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform} from "motion/react";
import {money} from "@/lib/format";
import {useReducedMotion} from "@/lib/ui";

/**
 * One share, broken on the way down the page.
 *
 * A pinned section drawn on a canvas in the relic palette, driven by scroll:
 *
 *   whole     one coin, one share
 *   crack     a line of light runs down the middle
 *   split     the halves part; shards fly off the break
 *   hollow    the right half empties into a ring — the Upside is worth nothing below the line
 *   reform    the two halves become the mark: a solid Floor overlapping an open Upside
 *
 * Every pixel is a cell on a fixed grid, so the break is pixel art at every frame rather than a
 * smooth vector scaled down. With reduced motion the finished mark is drawn once and held.
 */

const C = {b: "#0E1116", s: "#161A21", z: "#8C6A3F", o: "#D9924A", y: "#F0B46E", l: "#F7F4ED", d: "#5A3E1E"} as const;
type Col = keyof typeof C;

const N = 56;          // the coin's grid
const R = 26;          // coin radius, in cells
const RING_IN = 15;    // the Upside's hollow

/** Light from the top left, checker-dithered at the transitions. */
function lit(x: number, y: number, cx: number, cy: number, r: number): Col {
  const l = (-(x - cx) - (y - cy)) / (r * 1.414);
  const ch = (Math.floor(x) + Math.floor(y)) % 2 === 0;
  if (l > 0.5) return "y";
  if (l > 0.25) return ch ? "y" : "o";
  if (l < -0.55) return "z";
  if (l < -0.3) return ch ? "z" : "o";
  return "o";
}

/** A deterministic hash in [0, 1), so the dissolve order and the shards never change. */
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

type Cell = {x: number; y: number; c: Col; right: boolean; crack: number; hollow: boolean; order: number};

/** The whole coin, with the crack path decided once. */
function buildCoin() {
  const cx = N / 2, cy = N / 2;
  // A jagged fault line down the middle: a small random walk, never more than two cells off.
  const fault: number[] = [];
  let off = 0;
  for (let y = 0; y < N; y++) {
    off += hash(3, y) < 0.33 ? -1 : hash(3, y) > 0.66 ? 1 : 0;
    off = Math.max(-2, Math.min(2, off));
    fault.push(cx + off);
  }
  const cells: Cell[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d = Math.hypot(px - cx, py - cy);
      if (d > R) continue;
      let c: Col = d > R - 1.3 ? "z" : lit(px, py, cx, cy, R);
      // An inner engraved rim, dotted, like a struck coin.
      if (Math.abs(d - (R - 4)) < 0.5 && (x + y) % 2 === 0) c = "z";
      // The share's face: a carved disc and ring, the mark in miniature.
      if (Math.hypot(px - (cx - 4), py - (cy + 4)) < 6.5) c = "d";
      const dr = Math.hypot(px - (cx + 5), py - (cy - 5));
      if (dr > 4.2 && dr < 7.2) c = "b";
      if (dr > 4.8 && dr < 6.6) c = "d";
      cells.push({
        x, y, c,
        right: px > fault[y],
        crack: Math.abs(px - fault[y]),
        hollow: d < RING_IN,
        order: hash(x, y),
      });
    }
  }
  return {cells, fault};
}

/** The finished mark on the same grid: a solid disc lower left, an open ring upper right. */
function buildMark() {
  const cells: {x: number; y: number; c: Col; order: number}[] = [];
  const disc = {x: -9, y: 9, r: 15};
  const ring = {x: 10, y: -10, r1: 8.5, r2: 14};
  for (let y = -26; y <= 26; y++) {
    for (let x = -26; x <= 26; x++) {
      const px = x + 0.5, py = y + 0.5;
      const dd = Math.hypot(px - disc.x, py - disc.y);
      const dr = Math.hypot(px - ring.x, py - ring.y);
      const a = (Math.atan2(py - ring.y, px - ring.x) * 180) / Math.PI;
      const inGap = a > -16 && a < 30; // the ring's opening never closes
      let c: Col | null = null;
      if (dd <= disc.r) c = dd > disc.r - 1.2 ? "z" : lit(px, py, disc.x, disc.y, disc.r);
      // The ring is cut out of the disc with a ground-coloured moat, so they read as one object.
      if (!inGap && dr >= ring.r1 - 1.5 && dr <= ring.r2 + 1.5 && c) c = null;
      if (!inGap && dr >= ring.r1 && dr <= ring.r2) c = dr < ring.r1 + 1 || dr > ring.r2 - 1 ? "z" : lit(px, py, ring.x, ring.y, ring.r2);
      if (c) cells.push({x, y, c, order: hash(x + 90, y + 90)});
    }
  }
  return cells;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Where each chapter of the story starts, as a fraction of the pinned scroll. */
const CHAPTERS = [0, 0.12, 0.3, 0.5, 0.68];

export function CoinBreak({floor, upside, spot, strike, name}: {floor?: number; upside?: number; spot?: number; strike?: number; name: string}) {
  const wrap = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  const {scrollYProgress} = useScroll({target: wrap, offset: ["start start", "end end"]});
  const progress = useRef(0);
  const data = useRef<{coin: ReturnType<typeof buildCoin>; mark: ReturnType<typeof buildMark>} | null>(null);

  // Captions switch by chapter rather than fading on scroll: the compositor's scroll-linked
  // opacity drifts at the ends of the range, and a caption half-visible behind the next one is
  // worse than a clean swap.
  const [chapter, setChapter] = useState(0);
  const heard = useRef(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    progress.current = v;
    let c = 0;
    for (let i = 0; i < CHAPTERS.length; i++) if (v >= CHAPTERS[i]) c = i;
    // The coin is heard as well as seen, but only going forward: scrolling back is rewinding.
    if (c > heard.current) play(c === 1 ? "crack" : c === 4 ? "chime" : "clink");
    heard.current = Math.max(heard.current, c);
    setChapter(c);
  });

  useEffect(() => {
    data.current = {coin: buildCoin(), mark: buildMark()};
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0, visible = true;

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(cv);

    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
    };
    size();
    window.addEventListener("resize", size);

    const draw = (t: number) => {
      const {coin, mark} = data.current!;
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      // One cell is a whole number of device pixels, so the art never blurs.
      const cell = Math.max(2, Math.floor(Math.min(W / 124, H / 70)));
      const ox = Math.round(W / 2), oy = Math.round(H / 2);
      const p = reduce ? 1 : progress.current;

      const crack = ease(seg(p, 0.1, 0.28));
      const split = ease(seg(p, 0.28, 0.48));
      const hollow = seg(p, 0.48, 0.64);
      const reform = seg(p, 0.66, 0.84);
      const bob = reduce ? 0 : Math.sin(t / 700) * (1 - split) * 0.6;
      const shake = crack > 0 && crack < 1 && !reduce ? (hash(Math.floor(t / 40), 1) - 0.5) * 0.6 : 0;

      const put = (gx: number, gy: number, c: Col, alpha = 1) => {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = C[c];
        ctx.fillRect(ox + Math.round(gx) * cell, oy + Math.round(gy) * cell, cell, cell);
      };

      // ---- the coin and its halves, until the mark takes over
      if (reform < 1) {
        const gap = split * 22;
        const tilt = split * 0.12;
        for (const k of coin.cells) {
          // A cell dissolves out as the mark dithers in, in its own fixed order.
          if (reform > 0 && k.order < reform) continue;
          if (k.right && k.hollow && k.order < hollow) continue;

          let gx = k.x - N / 2, gy = k.y - N / 2 + bob;
          const isShard = k.crack < 1.6 && split > 0;
          if (isShard) {
            // Shards leave the break and fall away, spinning out on a fixed path.
            const dir = k.right ? 1 : -1;
            const v = 0.5 + k.order * 1.5;
            gx += dir * (gap + split * 14 * v);
            gy += split * split * 30 * v - split * 8 * k.order;
            put(gx + shake, gy, k.order > 0.5 ? "y" : "o", 1 - split);
            continue;
          }
          const dir = k.right ? 1 : -1;
          // Rotate each half about its own centre a little as it parts.
          const hx = gx - dir * 6, hy = gy;
          const rx = hx * Math.cos(dir * tilt) - hy * Math.sin(dir * tilt) + dir * 6;
          const ry = hx * Math.sin(dir * tilt) + hy * Math.cos(dir * tilt);
          let c = k.c;
          // The crack glows before it opens.
          if (k.crack < 1.2 && crack > 0 && split === 0 && (k.y / N) < crack) c = (Math.floor(t / 90) + k.y) % 3 ? "y" : "l";
          put(rx + dir * gap + shake, ry, c);
        }
      }

      // ---- the mark, dithered in over the halves
      if (reform > 0) {
        for (const m of mark) {
          if (m.order > reform) continue;
          put(m.x, m.y + bob, m.c);
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      if (visible) draw(t);
      raf = requestAnimationFrame(loop);
    };
    if (reduce) draw(0); else raf = requestAnimationFrame(loop);

    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener("resize", size); };
  }, [reduce]);

  const K = strike ? money(strike, 0) : "the line";
  const labelsIn = useTransform(scrollYProgress, [0.5, 0.56, 0.64, 0.68], [0, 1, 1, 0], {clamp: true});

  const captions = [
    <><span className="kicker">TABLET I · ONE SHARE</span><h2 className="display cb-h">This is one share of {name}.</h2>{spot ? <p className="lead">Worth <span className="num gold">{money(spot)}</span> today. Keep scrolling.</p> : null}</>,
    <><span className="kicker">TABLET II · THE LINE</span><h2 className="display cb-h">Pick a price. Say {K}.</h2><p className="lead">That price is where the share gets split, and it never moves.</p></>,
    <><span className="kicker">TABLET III · THE SPLIT</span><h2 className="display cb-h">The share breaks <span className="px-em">clean</span> at the line.</h2><p className="lead">Two tokens now, from one. Nothing is borrowed, so nothing can be liquidated.</p></>,
    <><span className="kicker">TABLET IV · TWO HALVES</span><h2 className="display cb-h">The Floor keeps the value up to it.</h2><p className="lead">The Upside gets everything above it. Below the line it&apos;s worth nothing, which is why it&apos;s hollow.</p></>,
    <><span className="kicker">TABLET V · YOUR CALL</span><h2 className="display cb-h">Keep one. Sell the other.</h2><p className="lead">Or hold both and put them back together into one share, any time you like.</p><TeleportLink href="/app" className="btn btn-primary btn-lg" style={{marginTop: 8}}>Choose your half</TeleportLink></>,
  ];

  return (
    <section ref={wrap} className="cb" aria-label="How a split works, in one coin">
      <div className="cb-stage">
        <div className="cb-copy">
          <AnimatePresence mode="wait">
            <motion.div key={chapter} className="cb-caption"
              initial={reduce ? false : {opacity: 0, y: 28, filter: "blur(8px)"}}
              animate={{opacity: 1, y: 0, filter: "blur(0px)"}}
              exit={reduce ? undefined : {opacity: 0, y: -20, filter: "blur(6px)"}}
              transition={{duration: 0.45, ease: [0.2, 0.7, 0.2, 1]}}>
              {captions[chapter]}
            </motion.div>
          </AnimatePresence>
          <div className="cb-dots" aria-hidden>{CHAPTERS.map((_, i) => <span key={i} className={i === chapter ? "on" : i < chapter ? "done" : ""} />)}</div>
        </div>

        <div className="cb-art">
          <canvas ref={canvas} className="cb-canvas" role="img"
                  aria-label="One share cracks into two halves: a solid Floor and a hollow Upside, which reform into the Aarka mark." />
          <motion.div className="cb-tag left" style={{opacity: labelsIn}} aria-hidden>
            <span className="label">FLOOR</span><b className="num gold">{floor ? money(floor) : "…"}</b><span className="small">value up to {K}</span>
          </motion.div>
          <motion.div className="cb-tag right" style={{opacity: labelsIn}} aria-hidden>
            <span className="label">UPSIDE</span><b className="num gold">{upside ? money(upside) : "…"}</b><span className="small">everything above {K}</span>
          </motion.div>
        </div>

        <motion.div className="cb-progress" aria-hidden style={{scaleX: scrollYProgress}} />
      </div>
    </section>
  );
}
