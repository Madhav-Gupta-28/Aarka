"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import type {ComponentProps, MouseEvent} from "react";

/**
 * A link that teleports. The screen fills with pixels spreading out from where you clicked, with a
 * sun flash at the centre, the page changes underneath while it's covered, and then the pixels
 * scatter to reveal the new page.
 *
 * The veil is a canvas on document.body, outside React, so it survives the route change and can
 * finish its exit on the new page. Modifier-clicks and reduced motion fall through to a plain link.
 */

const CELL = 22;          // pixel size, in CSS px
const IN_MS = 520, OUT_MS = 620;

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

let busy = false;

function teleport(ox: number, oy: number, go: () => void, arrived: () => boolean) {
  busy = true;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  const cv = document.createElement("canvas");
  cv.className = "teleport";
  cv.width = Math.ceil(W * dpr);
  cv.height = Math.ceil(H * dpr);
  cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue("--bg").trim() || "#0E1116";
  const accent = css.getPropertyValue("--accent").trim() || "#D9924A";
  const hot = css.getPropertyValue("--accent-text").trim() || "#F0B46E";

  const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
  const far = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy));
  // Each cell's moment, 0..1: mostly distance from the click, roughened so the edge reads as pixels.
  const at = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = Math.hypot(c * CELL + CELL / 2 - ox, r * CELL + CELL / 2 - oy) / far;
    at[r * cols + c] = Math.min(1, d * 0.78 + hash(c, r) * 0.22);
  }

  // One frame, p running 0→1. On the way in cells appear; on the way out they leave, nearest the
  // click first, so the new page opens from where you tapped.
  const frame = (p: number, out: boolean) => {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < at.length; i++) {
      // Each cell takes 30% of the run, starting when the wavefront reaches it.
      const k = Math.max(0, Math.min(1, (p - at[i] * 0.7) / 0.3));
      const c = i % cols, r = (i / cols) | 0;
      // In, a cell grows from nothing; out, it shrinks to nothing.
      const grow = out ? 1 - ease(k) : ease(k);
      if (grow <= 0) continue;
      const s = CELL * grow;
      // A thin band of lit cells rides the wavefront; everything behind it (or ahead of it, on the
      // way out) is basalt.
      const lit = out ? k > 0 && k < 0.6 : k < 0.55;
      ctx.fillStyle = lit ? (hash(c + 7, r) > 0.5 ? hot : accent) : bg;
      ctx.fillRect(c * CELL + (CELL - s) / 2, r * CELL + (CELL - s) / 2, s, s);
    }
    // The sun at the origin: a flash that swells as the veil closes.
    const flash = out ? 0 : Math.sin(Math.min(1, p * 1.4) * Math.PI);
    if (flash > 0) {
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, 180 + 260 * p);
      g.addColorStop(0, `rgba(247, 226, 191, ${0.7 * flash})`);
      g.addColorStop(0.3, `rgba(240, 180, 110, ${0.35 * flash})`);
      g.addColorStop(1, "rgba(217, 146, 74, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  };

  const run = (ms: number, out: boolean, done: () => void) => {
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      frame(p, out);
      if (p < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  };

  run(IN_MS, false, () => {
    frame(1, false);
    go();
    // Wait for the new page to be in place (or give up after 3s), then two frames for it to paint.
    const t0 = performance.now();
    const wait = () => {
      if (!arrived() && performance.now() - t0 < 3000) return void requestAnimationFrame(wait);
      window.scrollTo(0, 0);
      requestAnimationFrame(() => requestAnimationFrame(() => run(OUT_MS, true, () => { cv.remove(); busy = false; })));
    };
    wait();
  });
}

export function TeleportLink({href, onClick, ...rest}: ComponentProps<typeof Link> & {href: string}) {
  const router = useRouter();
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = new URL(href, location.href).pathname;
    if (target === location.pathname) return; // already here: an ordinary link scrolls or does nothing
    e.preventDefault();
    if (busy) return;
    teleport(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2, () => router.push(href), () => location.pathname === target);
  };
  return <Link href={href} onClick={click} {...rest} />;
}
