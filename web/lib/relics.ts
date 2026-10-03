/**
 * The pixel relic library, drawn from code on 16/32/48px grids in the six-colour palette.
 *
 * Every relic is a grid of palette keys turned into a crisp SVG data URI, so nothing here is a
 * bitmap asset and every relic scales by whole numbers with `image-rendering: pixelated`.
 */

type Cell = 0 | "b" | "s" | "z" | "o" | "y" | "l";
type Grid = Cell[][];

const PX: Record<Exclude<Cell, 0>, string> = {
  b: "#0E1116", s: "#161A21", z: "#8C6A3F", o: "#D9924A", y: "#F0B46E", l: "#F7F4ED",
};

function G(n: number): Grid {
  return Array.from({length: n}, () => new Array<Cell>(n).fill(0));
}

function put(g: Grid, x: number, y: number, c: Cell) {
  x = Math.round(x);
  y = Math.round(y);
  if (y >= 0 && y < g.length && x >= 0 && x < g.length) g[y][x] = c;
}

function each(g: Grid, f: (x: number, y: number, px: number, py: number) => void) {
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g.length; x++) f(x, y, x + 0.5, y + 0.5);
}

/** Dim swaps the warm colours for bronze, for a price source that has gone quiet. */
function url(g: Grid, dim = false): string {
  const n = g.length;
  let r = "";
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      const c = g[y][x];
      let e = x;
      while (e < n && g[y][e] === c) e++;
      if (c) {
        const fill = dim && c !== "b" ? (c === "y" || c === "o" ? "#8C6A3F" : "#4A3A26") : PX[c];
        r += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${fill}"/>`;
      }
      x = e;
    }
  }
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">${r}</svg>`);
}

/** Light from the top left, shaded with a checker dither rather than a gradient. */
function lit(x: number, y: number, cx: number, cy: number, r: number): Cell {
  const l = (-(x - cx) - (y - cy)) / (r * 1.414);
  const ch = (Math.floor(x) + Math.floor(y)) % 2 === 0;
  if (l > 0.5) return "y";
  if (l > 0.25) return ch ? "y" : "o";
  if (l < -0.55) return "z";
  if (l < -0.3) return ch ? "z" : "o";
  return "o";
}

function disc(g: Grid, cx: number, cy: number, r: number, rim: boolean) {
  each(g, (x, y, px, py) => {
    const d = Math.hypot(px - cx, py - cy);
    if (d <= r) put(g, x, y, rim && d > r - 1.1 ? "z" : lit(px, py, cx, cy, r));
  });
}

/** A ring, optionally with a gap between angles g0 and g1 (degrees). The gap is the Upside. */
function ring(g: Grid, cx: number, cy: number, r1: number, r2: number,
              g0: number | null, g1: number | null, col?: Cell) {
  each(g, (x, y, px, py) => {
    const d = Math.hypot(px - cx, py - cy);
    if (d < r1 || d > r2) return;
    const a = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
    if (g0 != null && g1 != null && a >= g0 && a <= g1) return;
    put(g, x, y, col || (d < r1 + 1 || d > r2 - 1 ? "z" : lit(px, py, cx, cy, r2)));
  });
}

function line(g: Grid, x0: number, y0: number, x1: number, y1: number, c: Cell) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) put(g, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
}

function rect(g: Grid, x: number, y: number, w: number, h: number, c: Cell) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(g, i, j, c);
}

/** Break a relic along a rough vertical edge, as if excavated. Empty states and 404 only. */
function frag(src: Grid, seed: number): Grid {
  const n = src.length;
  const g = src.map((r) => r.slice());
  for (let y = 0; y < n; y++) {
    const cut = n * 0.64 + Math.sin(y * 1.3 + seed) * 2.4 + ((y * 7 + seed * 3) % 3);
    for (let x = 0; x < n; x++) {
      if (x > cut || x + y < n * 0.16 + ((x * 5 + seed) % 2)) g[y][x] = 0;
      else if (x > cut - 1.2 && g[y][x]) g[y][x] = "z";
    }
  }
  for (let k = 0; k < 5; k++) {
    put(g, Math.round(n * 0.72 + ((k * 37 + seed * 11) % 6)),
        Math.round(n * 0.2 + ((k * 53 + seed * 7) % (n * 0.6))), "z");
  }
  return g;
}

// ---- the relics -------------------------------------------------------------------------------

function coinFloor(): Grid {
  const g = G(32);
  disc(g, 16, 16, 14.5, true);
  each(g, (x, y, px, py) => {
    const d = Math.hypot(px - 16, py - 16);
    if (Math.abs(d - 10) < 0.5 && (x + y) % 2 === 0) put(g, x, y, "z");
  });
  return g;
}

function coinUp(): Grid {
  const g = G(32);
  ring(g, 16, 16, 9, 14.5, -28, 32);
  return g;
}

/** One whole share: a solid coin with the mark carved into it. */
function coinFull(): Grid {
  const g = G(32);
  disc(g, 16, 16, 14.5, true);
  each(g, (x, y, px, py) => { if (Math.hypot(px - 13, py - 18) <= 4.2) put(g, x, y, "z"); });
  ring(g, 19, 14, 3.1, 4.6, -28, 32, "b");
  ring(g, 19, 14, 3.6, 4.3, -28, 32, "z");
  return g;
}

/** The sun disk on a 48px grid. Frame f moves a gap outward along each ray. */
function sun48(f: number): Grid {
  const g = G(48);
  ring(g, 24, 24, 10, 11, null, null, "z");
  each(g, (x, y, px, py) => {
    const d = Math.hypot(px - 24, py - 24);
    if (d > 11 && d < 13 && (x + y) % 2 === 0) put(g, x, y, "z");
  });
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, card = k % 2 === 0, len = card ? 23 : 17;
    for (let t = 12; t <= len; t++) {
      if ((((t - 12 - f) % 4) + 4) % 4 === 3) continue;
      const c: Cell = t < 15 ? "y" : t < 19 ? "o" : "z";
      put(g, 24 + Math.cos(a) * t, 24 + Math.sin(a) * t, c);
      if (card && t < 17) {
        put(g, 24 + Math.cos(a) * t - Math.sin(a), 24 + Math.sin(a) * t + Math.cos(a), "o");
        put(g, 24 + Math.cos(a) * t + Math.sin(a), 24 + Math.sin(a) * t - Math.cos(a), "o");
      }
    }
  }
  disc(g, 24, 24, 8.5, false);
  each(g, (x, y, px, py) => { if (Math.hypot(px - 22.5, py - 22.5) < 2.4) put(g, x, y, "l"); });
  return g;
}

function sunSmall(): Grid {
  const g = G(16);
  disc(g, 8, 8, 3.6, false);
  [[8, 1], [8, 2], [8, 14], [8, 13], [1, 8], [2, 8], [14, 8], [13, 8], [3, 3], [12, 3], [3, 12], [12, 12]]
    .forEach(([x, y]) => put(g, x, y, x === 8 || y === 8 ? "y" : "o"));
  put(g, 7, 7, "l");
  return g;
}

/** The slider handle: a slightly larger sun with a bronze rim. */
function sunHandle(): Grid {
  const g = G(16);
  [[8, 0], [8, 1], [8, 15], [8, 14], [0, 8], [1, 8], [15, 8], [14, 8], [2, 2], [13, 2], [2, 13], [13, 13]]
    .forEach(([x, y]) => put(g, x, y, x === 8 || y === 8 ? "y" : "o"));
  disc(g, 8, 8, 5.2, false);
  ring(g, 8, 8, 5.2, 6, null, null, "b");
  disc(g, 8, 8, 4.6, false);
  put(g, 6, 6, "l"); put(g, 7, 6, "l"); put(g, 6, 7, "l");
  return g;
}

function scales(): Grid {
  const g = G(32);
  rect(g, 15, 6, 2, 21, "z"); rect(g, 15, 6, 1, 21, "o");
  rect(g, 10, 27, 12, 2, "z"); rect(g, 11, 26, 10, 1, "o"); rect(g, 8, 29, 16, 1, "z");
  rect(g, 4, 8, 24, 1, "o"); rect(g, 4, 9, 24, 1, "z");
  disc(g, 16, 5, 2.3, false);
  line(g, 5, 10, 2, 19, "z"); line(g, 5, 10, 8, 19, "z"); line(g, 26, 10, 23, 19, "z"); line(g, 26, 10, 29, 19, "z");
  rect(g, 1, 19, 9, 1, "y"); rect(g, 2, 20, 7, 1, "o"); rect(g, 3, 21, 5, 1, "z");
  rect(g, 22, 19, 9, 1, "y"); rect(g, 23, 20, 7, 1, "o"); rect(g, 24, 21, 5, 1, "z");
  return g;
}

function stele(): Grid {
  const g = G(32);
  each(g, (x, y, px, py) => {
    const inDome = y < 11 && Math.hypot(px - 16, py - 11) <= 9.5;
    const inBody = y >= 11 && y < 29 && x >= 7 && x <= 24;
    if (inDome || inBody) put(g, x, y, "s");
  });
  each(g, (x, y) => {
    if (g[y][x] !== "s") return;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !g[y + b] || !g[y + b][x + a]);
    if (edge) put(g, x, y, x > 16 || y > 20 ? "z" : "o");
  });
  disc(g, 16, 8, 2.4, false);
  [[16, 4], [12, 8], [20, 8], [16, 12]].forEach(([x, y]) => put(g, x, y, "o"));
  [15, 18, 21, 24].forEach((y, i) => {
    for (let x = 10; x <= 21; x++) if ((x * 7 + y * 3 + i) % 5 < 3) { put(g, x, y, "o"); put(g, x, y + 1, "z"); }
  });
  rect(g, 5, 29, 22, 2, "z"); rect(g, 5, 29, 22, 1, "o");
  return g;
}

/** The astrolabe dial. `frac` of the inner arc is lit: how much of the time has passed. */
function astro(frac: number): Grid {
  const g = G(32);
  ring(g, 16, 16, 13, 14.6, null, null);
  each(g, (x, y, px, py) => {
    const d = Math.hypot(px - 16, py - 16);
    if (Math.abs(d - 9.5) < 0.55) put(g, x, y, (x + y) % 2 ? "o" : "z");
  });
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    put(g, 16 + Math.cos(a) * 11.5, 16 + Math.sin(a) * 11.5, "y");
  }
  const f = Math.max(0, Math.min(1, frac));
  for (let a = -Math.PI / 2; a < -Math.PI / 2 + Math.PI * 2 * f; a += 0.05) {
    put(g, 16 + Math.cos(a) * 7.3, 16 + Math.sin(a) * 7.3, "y");
  }
  const e = -Math.PI / 2 + Math.PI * 2 * f;
  line(g, 16, 16, Math.round(16 + Math.cos(e) * 8), Math.round(16 + Math.sin(e) * 8), "l");
  disc(g, 16, 16, 1.7, false);
  return g;
}

function tablet(): Grid {
  const g = G(32);
  for (let y = 5; y < 28; y++) {
    for (let x = 4; x < 28; x++) {
      if ((x === 4 || x === 27) && (y === 5 || y === 27)) continue;
      const edge: Cell | null = x === 4 || y === 5 ? "y" : x === 27 || y === 27 ? "z" : null;
      put(g, x, y, edge || ((x + y) % 2 && x + y > 34 ? "z" : "o"));
    }
  }
  [9, 13, 17, 21, 24].forEach((y, i) => {
    for (let x = 7; x <= 24; x++) if ((x * 5 + y + i * 3) % 7 < 4) { put(g, x, y, "b"); put(g, x, y + 1, "y"); }
  });
  return g;
}

function gear(n: number, f: number): Grid {
  const g = G(n), c = n / 2, R = n * 0.3, ri = n * 0.12, step = (2 * Math.PI) / 8;
  each(g, (x, y, px, py) => {
    const d = Math.hypot(px - c, py - c), a = Math.atan2(py - c, px - c);
    const rel = (((a - (f * step) / 4) % step) + step) % step;
    const outer = rel < step * 0.5 ? R + n * 0.14 : R;
    if (d <= outer && d > ri) put(g, x, y, d > outer - 1 ? "z" : lit(px, py, c, c, outer));
  });
  return g;
}

function chart(): Grid {
  const g = G(32);
  rect(g, 3, 28, 27, 1, "z"); rect(g, 3, 4, 1, 25, "z");
  const pts = [22, 20, 21, 17, 18, 14, 15, 11, 12, 9, 7, 8, 5];
  for (let x = 4; x < 30; x++) {
    const i = Math.min(12, Math.floor((x - 4) / 2)), t = pts[i];
    put(g, x, t, "y");
    for (let y = t + 1; y < 28; y++) if ((x + y) % 2 === 0) put(g, x, y, y < t + 3 ? "o" : "z");
  }
  return g;
}

/** A small stack of cash, for "buy with cash". */
function cash(): Grid {
  const g = G(32);
  for (let k = 0; k < 4; k++) { rect(g, 5, 20 - k * 4, 22, 3, k % 2 ? "o" : "y"); rect(g, 5, 22 - k * 4, 22, 1, "z"); }
  rect(g, 5, 23, 22, 1, "z");
  return g;
}

function lock(): Grid {
  const g = G(32);
  ring(g, 16, 13, 6, 8.5, 10, 170);
  rect(g, 7, 14, 18, 13, "o"); rect(g, 7, 14, 18, 1, "y"); rect(g, 7, 26, 18, 1, "z"); rect(g, 15, 18, 2, 5, "b");
  return g;
}

// ---- exports ----------------------------------------------------------------------------------

const astroCache = new Map<number, string>();

export const RELIC = (() => {
  const cf = coinFloor(), cu = coinUp(), cw = coinFull(), st = stele(), tb = tablet(), sn = sun48(0);
  return {
    coinFloor: url(cf),
    coinUp: url(cu),
    coinFull: url(cw),
    sunFrames: [0, 1, 2, 3].map((f) => url(sun48(f))),
    sun: url(sn),
    sunDim: url(sn, true),
    sunSmall: url(sunSmall()),
    sunHandle: url(sunHandle()),
    scales: url(scales()),
    stele: url(st),
    tablet: url(tb),
    chart: url(chart()),
    cash: url(cash()),
    lock: url(lock()),
    gears: [0, 1, 2, 3].map((f) => url(gear(24, f))),
    gearsBig: [0, 1, 2, 3].map((f) => url(gear(32, f))),
    fragTablet: url(frag(tb, 3)),
    fragCoin: url(frag(cw, 1)),
    fragStele: url(frag(st, 5)),
    fragAstro: url(frag(astro(0.6), 4)),
    /** The astrolabe with `frac` of the time passed, rounded to 1/32 so there are few variants. */
    astro(frac: number) {
      const k = Math.round(Math.max(0, Math.min(1, frac)) * 32);
      if (!astroCache.has(k)) astroCache.set(k, url(astro(k / 32)));
      return astroCache.get(k)!;
    },
  };
})();

