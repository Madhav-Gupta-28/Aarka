"use client";

import {useEffect, useRef} from "react";
import {useReducedMotion} from "@/lib/ui";

/**
 * The Tablet of Shamash, redrawn as a grid of characters, with sonar.
 *
 * The art is sampled once into a grid of luminance cells. Every frame each cell is drawn as one
 * character from a ramp, in a palette step chosen by its brightness. Rings leave the sun disk every
 * few seconds and brighten the cells they pass, so the sun reads as the source of everything on the
 * tablet — which is the brand's whole idea: The Sun sets every price. The pointer lights the cells
 * under it.
 *
 * Characters are pre-rendered into a small atlas, one sprite per brightness step, so a frame is a
 * few thousand drawImage calls rather than a few thousand fillText calls. It pauses off-screen, and
 * with reduced motion it draws a single still frame.
 */

const RAMP = " .·:-=+*%#@";
// Basalt to bright sun, one colour per ramp step.
const STEPS = ["#0E1116", "#1B1F26", "#2A2F38", "#3A3024", "#5A3E1E", "#7A5530", "#8C6A3F", "#B07A3E", "#D9924A", "#F0B46E", "#F7E2BF"];

/** Where the sun disk sits in the source art, as a fraction of its width and height. */
const SUN = {x: 0.58, y: 0.48};

export function SonarAscii({src = "/art/tablet.jpg", className}: {src?: string; className?: string}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const img = new Image();
    img.src = src;
    let raf = 0, visible = true, alive = true;
    let lum: Float32Array = new Float32Array(0), cols = 0, rows = 0, cw = 0, ch = 0;
    let sunX = 0, sunY = 0;
    const art = {x: 0, y: 0, w: 0, h: 0};
    let atlas: HTMLCanvasElement | null = null;
    const pointer = {x: -9999, y: -9999};

    const font = () => getComputedStyle(document.documentElement).getPropertyValue("--f-px").trim() || "monospace";

    const layout = () => {
      if (!img.complete || !img.naturalWidth) return;
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cw = Math.max(4, Math.round((r.width < 720 ? 5 : 6) * dpr));
      ch = Math.round(cw * 1.6);
      cols = Math.ceil(cv.width / cw);
      rows = Math.ceil(cv.height / ch);

      // Place the sun, not the picture: the disk sits 60% across, and the art is scaled so Shamash,
      // at 92% of the art's width, still fits inside the frame. On a phone the sun is centred.
      const narrow = r.width < 720;
      const sunAt = narrow ? 0.5 : 0.66;
      const scale = Math.min(cv.height / img.naturalHeight, ((narrow ? 0.46 : 0.3) * cv.width) / ((0.92 - SUN.x) * img.naturalWidth));
      const artW = img.naturalWidth * scale, artH = img.naturalHeight * scale;
      const artX = sunAt * cv.width - SUN.x * artW;
      const artY = (cv.height - artH) * (narrow ? 0.18 : 0.62);
      sunX = artX + SUN.x * artW;
      sunY = artY + SUN.y * artH;
      Object.assign(art, {x: artX, y: artY, w: artW, h: artH});

      const off = document.createElement("canvas");
      off.width = cols;
      off.height = rows;
      const o = off.getContext("2d", {willReadFrequently: true})!;
      o.fillStyle = "#000";
      o.fillRect(0, 0, cols, rows);
      o.drawImage(img, artX / cw, artY / ch, artW / cw, artH / ch);
      const px = o.getImageData(0, 0, cols, rows).data;
      lum = new Float32Array(cols * rows);
      for (let i = 0; i < cols * rows; i++) {
        lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
      }
      // The art is dark by design: its median is about a tenth of full brightness, the carved relief
      // sits between the 25th and 90th percentiles, and only the sun disk is truly bright. So the
      // stretch runs from the 10th to the 94th percentile, clipping the sun to the top step, and a
      // gamma lift spreads the relief across the ramp where it reads as carving.
      const sorted = Float32Array.from(lum).sort();
      const lo = sorted[Math.floor(sorted.length * 0.1)];
      const hi = sorted[Math.floor(sorted.length * 0.94)] || 1;
      for (let i = 0; i < lum.length; i++) {
        const t = Math.max(0, Math.min(1, (lum[i] - lo) / Math.max(1e-3, hi - lo)));
        lum[i] = Math.pow(t, 0.6);
      }

      atlas = document.createElement("canvas");
      atlas.width = cw * RAMP.length;
      atlas.height = ch;
      const a = atlas.getContext("2d")!;
      a.font = `${Math.round(ch * 0.78)}px ${font()}`;
      a.textAlign = "center";
      a.textBaseline = "middle";
      for (let i = 1; i < RAMP.length; i++) {
        a.fillStyle = STEPS[i];
        a.fillText(RAMP[i], i * cw + cw / 2, ch / 2);
      }
    };

    const draw = (t: number) => {
      if (!atlas) return;
      ctx.fillStyle = "#0E1116";
      ctx.fillRect(0, 0, cv.width, cv.height);
      // The art itself, dim, underneath: the characters carry the texture and the sonar, and the
      // picture carries the shape, so the scene still reads as Shamash at a glance.
      ctx.globalAlpha = 0.34;
      ctx.drawImage(img, art.x, art.y, art.w, art.h);
      ctx.globalAlpha = 1;

      // The sun is the source of everything on the tablet, so it glows, and swells as each ring
      // leaves it.
      const beat = reduce ? 0 : Math.pow(1 - ((t % 2800) / 2800), 3);
      const gr = art.h * (0.2 + 0.04 * beat);
      const g = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, gr);
      g.addColorStop(0, `rgba(247, 226, 191, ${0.55 + 0.25 * beat})`);
      g.addColorStop(0.25, "rgba(240, 180, 110, 0.32)");
      g.addColorStop(1, "rgba(217, 146, 74, 0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.fillRect(sunX - gr, sunY - gr, gr * 2, gr * 2);
      ctx.globalCompositeOperation = "source-over";
      const period = 2800, speed = Math.max(cv.width, cv.height) / 2400;
      const band = cw * 3.2;
      const rings = reduce ? [] : [0, 1, 2].map((k) => ((t + k * period) % (period * 3)) * speed);
      const dpr = cv.width / cv.getBoundingClientRect().width || 1;
      const mx = pointer.x * dpr, my = pointer.y * dpr, glow = 140 * dpr;

      for (let r = 0; r < rows; r++) {
        const y = r * ch + ch / 2;
        for (let c = 0; c < cols; c++) {
          let l = lum[r * cols + c];
          const x = c * cw + cw / 2;
          if (!reduce) {
            const d = Math.hypot(x - sunX, y - sunY);
            for (const R of rings) {
              const k = 1 - Math.abs(d - R) / band;
              if (k > 0) l += k * 0.42 * Math.max(0, 1 - R / (cv.width * 0.9));
            }
            const dp = Math.hypot(x - mx, y - my);
            if (dp < glow) l += (1 - dp / glow) * 0.35;
          }
          const step = Math.min(RAMP.length - 1, Math.floor(l * (RAMP.length - 0.01)));
          if (step > 0) ctx.drawImage(atlas, step * cw, 0, cw, ch, c * cw, r * ch, cw, ch);
        }
      }
    };

    let last = 0;
    const loop = (t: number) => {
      if (!alive) return;
      // Thirty frames a second is plenty for a ripple, and halves the cost.
      if (visible && t - last > 32) { draw(t); last = t; }
      raf = requestAnimationFrame(loop);
    };

    let started = false;
    const start = () => {
      if (started || !alive) return;
      started = true;
      layout();
      if (reduce) draw(0);
      else raf = requestAnimationFrame(loop);
    };
    // Wait for the pixel font, or the atlas is drawn in a fallback face.
    img.onload = () => { (document.fonts?.ready ?? Promise.resolve()).then(start); };
    if (img.complete) img.onload?.(new Event("load"));

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(cv);
    const onResize = () => { layout(); if (reduce) draw(0); };
    window.addEventListener("resize", onResize);
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
    };
    const onLeave = () => { pointer.x = pointer.y = -9999; };
    window.addEventListener("pointermove", onMove, {passive: true});
    document.addEventListener("pointerleave", onLeave);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [src, reduce]);

  return <canvas ref={canvas} className={className} aria-hidden />;
}
