/**
 * The relic palette and lighting, shared by every coin drawn on a canvas: the landing page's coin
 * break, the app's coin stage, and the deep-dive coins. One light, from the top left, so every
 * coin on the site is lit the same way.
 */

export const C = {b: "#0E1116", s: "#161A21", z: "#8C6A3F", o: "#D9924A", y: "#F0B46E", l: "#F7F4ED", d: "#5A3E1E"} as const;
export type Col = keyof typeof C;

/** Light from the top left, checker-dithered at the transitions. */
export function lit(x: number, y: number, cx: number, cy: number, r: number): Col {
  const l = (-(x - cx) - (y - cy)) / (r * 1.414);
  const ch = (Math.floor(x) + Math.floor(y)) % 2 === 0;
  if (l > 0.5) return "y";
  if (l > 0.25) return ch ? "y" : "o";
  if (l < -0.55) return "z";
  if (l < -0.3) return ch ? "z" : "o";
  return "o";
}

/** A deterministic hash in [0, 1), so dissolves and sparks never change between renders. */
export const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** One step brighter, for a light sweep. */
export const brighter: Record<Col, Col> = {b: "s", s: "d", d: "z", z: "o", o: "y", y: "l", l: "l"};
/** One step darker, for the half you didn't pick. */
export const darker: Record<Col, Col> = {l: "y", y: "o", o: "z", z: "d", d: "s", s: "b", b: "b"};

/**
 * A struck coin's face on an n×n grid: rim, dotted inner rim, and the mark in miniature.
 * Returns the colour of each cell, or null outside the coin.
 */
export function coinFace(n: number, mark = true): (Col | null)[] {
  const cx = n / 2, cy = n / 2, r = n / 2 - 1;
  const out: (Col | null)[] = new Array(n * n).fill(null);
  const k = r / 26; // the face was designed at radius 26
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d = Math.hypot(px - cx, py - cy);
      if (d > r) continue;
      let c: Col = d > r - 1.3 ? "z" : lit(px, py, cx, cy, r);
      if (Math.abs(d - (r - 4 * k)) < 0.5 && (x + y) % 2 === 0) c = "z";
      if (!mark) { out[y * n + x] = c; continue; }
      if (Math.hypot(px - (cx - 4 * k), py - (cy + 4 * k)) < 6.5 * k) c = "d";
      const dr = Math.hypot(px - (cx + 5 * k), py - (cy - 5 * k));
      if (dr > 4.2 * k && dr < 7.2 * k) c = "b";
      if (dr > 4.8 * k && dr < 6.6 * k) c = "d";
      out[y * n + x] = c;
    }
  }
  return out;
}

/**
 * A coin struck with an emblem: the 16×16 picture is carved into the face at double size, dark
 * where it's cut, with a lit edge on the lower right where the light catches the cut.
 */
export function struckFace(n: number, art: string[]): (Col | null)[] {
  const out = coinFace(n, false);
  const s = 2, w = 16 * s;
  const x0 = Math.round(n / 2 - w / 2), y0 = Math.round(n / 2 - (art.length * s) / 2);
  const cut = new Set<number>();
  art.forEach((row, ey) => row.split("").forEach((ch, ex) => {
    if (ch === ".") return;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const x = x0 + ex * s + dx, y = y0 + ey * s + dy, i = y * n + x;
      if (out[i]) { out[i] = ch === "o" ? "z" : "d"; cut.add(i); }
    }
  }));
  cut.forEach((i) => {
    for (const j of [i + 1, i + n]) if (out[j] && !cut.has(j)) out[j] = "y";
  });
  return out;
}
