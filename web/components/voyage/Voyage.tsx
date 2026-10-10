"use client";

import {motion} from "motion/react";
import {Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {pickFeatured, quoteFor, stocksOf, useParityAll, useSeries} from "@/lib/data";
import {endShort, money, n8, stockName} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {play} from "@/lib/sound";
import {useReducedMotion} from "@/lib/ui";
import type {Seg} from "../Inscription";
import {Pills} from "../Kinetic";
import {Relic} from "../Relic";
import {TeleportLink} from "../Teleport";
import {Cargo} from "./Cargo";
import {ChamberView} from "./Chamber";
import {Spec} from "./Spec";
import {Term, VoyageCtx} from "./Term";
import type {Chamber, TermKey} from "./terms";

/**
 * How it works, as a voyage. A river runs the length of the page and a reed boat rides it as you
 * scroll, carrying a coin. At each of eight ports the boat slows and docks, the coin changes to
 * show that port's idea, and a clay tablet rises beside it and writes itself. Key words open a
 * preview on hover and a 3D deep dive on click. Spec mode turns the whole thing into a reference.
 */

const T = (k: TermKey, label: string): Seg => ({node: <Term k={k}>{label}</Term>, text: label});

type Port = {id: string; n: string; title: [string, string]; name: string; segs: Seg[]; pull: string; Extra?: () => React.ReactElement | null};

const PORTS: Port[] = [
  {id: "share", n: "I", name: "The share", title: ["The ", "share"],
   segs: ["A share is a small piece of a company. When its price goes up, your share is worth more; when it goes down, less. Every split starts with one share: yours, or a free practice one."],
   pull: "One share. One price. That's where it starts.", Extra: LivePrice},
  {id: "line", n: "II", name: "The line", title: ["The ", "line"],
   segs: [T("line", "The line"), " is a price, like $230. It's where a share is cut in two. Each split also has an ", T("end", "end date"), ". Neither one ever changes once the split exists."],
   pull: "A price and a date. Everything turns on them.", Extra: LiveLines},
  {id: "halves", n: "III", name: "Two halves", title: ["Two ", "halves"],
   segs: ["Split a share and you hold two pieces. The ", T("floor", "Floor"), " gets the share's value up to the line. The ", T("upside", "Upside"), " gets everything above it. Together they always make exactly one share, so you can ", T("rejoin", "put them back together"), " at any moment."],
   pull: "Floor and Upside make one share. Always.", Extra: LiveEquation},
  {id: "endings", n: "IV", name: "Three endings", title: ["Three ", "endings"],
   segs: ["On the end date, the ", T("final", "final price"), " decides what each piece pays. Below the line, the Floor takes it all and the Upside ends at $0. Above it, the Floor stops at the line and the Upside takes the rest."],
   pull: "The Floor stops at the line. The Upside starts there.", Extra: Endings},
  {id: "final", n: "V", name: "The final day", title: ["The final ", "day"],
   segs: ["At the end time, ", T("sun", "The Sun"), " has the last word: its last price at or before the end becomes the final price. For ", T("window", "one hour"), " anyone can correct it with a later price the rules allow. Then you ", T("collect", "collect"), ", whenever you like."],
   pull: "The Sun sets it. You collect it.", Extra: MiniTimeline},
  {id: "sun", n: "VI", name: "The Sun", title: ["The ", "Sun"],
   segs: [T("sun", "The Sun"), " is Chainlink's public price network. It publishes a price whenever the stock moves, and at least once a day. Aarka only reads it. Nobody here can set or change a price."],
   pull: "Independent. Public. Nobody's thumb on it.", Extra: LiveFeeds},
  {id: "scales", n: "VII", name: "The Scales", title: ["The ", "Scales"],
   segs: ["A Floor and an Upside always make one share, so their prices should add up to one share's price. ", T("scales", "The Scales"), " act inside trades that push the two apart, buying the cheap side and selling the dear one, so the halves keep tracking the whole."],
   pull: "Two halves, one price, kept in line by code.", Extra: LiveParity},
  {id: "risks", n: "VIII", name: "The risks", title: ["The risks, ", "honestly"],
   segs: ["You can lose money. The ", T("upside", "Upside"), " can end at $0. The ", T("floor", "Floor"), " still falls if the stock falls. If you sell the Upside, you give away the growth above the line."],
   pull: "Only use money you're comfortable losing.", Extra: Risks},
];

export function Voyage() {
  const [mode, setMode] = useState<"story" | "spec">("story");
  const [chamber, setChamber] = useState<Chamber | null>(null);
  useEffect(() => {
    try { const m = localStorage.getItem("aarka.docs"); if (m === "spec" || m === "story") setMode(m); } catch { /* default */ }
  }, []);
  const pick = (m: "story" | "spec") => { setMode(m); try { localStorage.setItem("aarka.docs", m); } catch { /* not remembered */ } };
  const open = useCallback((c: Chamber) => setChamber(c), []);
  const close = useCallback(() => setChamber(null), []);

  return (
    <VoyageCtx.Provider value={{open}}>
      <section className="voyage-intro gridlines">
        <div className="wrap voyage-intro-in">
          <div className="stack gap-16">
            <span className="kicker">F3 · HOW IT WORKS · EIGHT PORTS · ABOUT 6 MIN</span>
            <h1 className="display h-xl">How a split <span className="px-em">works</span></h1>
            <p className="lead" style={{maxWidth: 560}}>One share, one line, one date. Ride the river down; at each port the coin changes and a tablet writes what it means. Words with a <span className="gold">◆</span> open up.</p>
          </div>
          <div className="stack gap-12" style={{alignItems: "flex-start"}}>
            <span className="label">READ IT AS</span>
            <Pills id="docs-mode" value={mode} onChange={pick} options={[
              {value: "story", label: "Story", sub: "the voyage"},
              {value: "spec", label: "Spec", sub: "for builders"},
            ]} />
          </div>
        </div>
        {mode === "story" && <a href="#share" className="voyage-cue mono">SET SAIL ↓</a>}
      </section>

      {mode === "story" ? <River /> : <Spec onOpen={open} />}
      <Harbour />
      <ChamberView id={chamber} onClose={close} />
    </VoyageCtx.Provider>
  );
}

// ── The river ────────────────────────────────────────────────────────────────────────────────

function River() {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLElement | null)[]>([]);
  const path = useRef<SVGPathElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const boat = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const [geo, setGeo] = useState<{W: number; H: number; pts: {x: number; y: number}[]; narrow: boolean} | null>(null);
  const [at, setAt] = useState(-1);         // the port the boat is at (or just past)
  const [reached, setReached] = useState(-1); // the furthest port reached; its tablet has been written

  // Where the ports are: the middle of each tablet, on the river side.
  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const narrow = r.width < 860;
      const pts = cards.current.map((c, i) => {
        if (!c) return {x: 0, y: 0};
        const cr = c.getBoundingClientRect();
        const y = (narrow ? cr.top + 70 : cr.top + cr.height / 2) - r.top;
        const x = narrow ? 26 + (i % 2 ? 8 : 0) : r.width * (i % 2 ? 0.8 : 0.2);
        return {x, y};
      });
      setGeo({W: r.width, H: r.height, pts, narrow});
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const d = useMemo(() => {
    if (!geo) return "";
    const {pts, H, W, narrow} = geo;
    const all = [{x: pts[0].x, y: 0}, ...pts, {x: narrow ? 30 : W / 2, y: H}];
    let s = `M ${all[0].x} ${all[0].y}`;
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1], b = all[i], m = (b.y - a.y) / 2;
      s += ` C ${a.x} ${a.y + m}, ${b.x} ${b.y - m}, ${b.x} ${b.y}`;
    }
    return s;
  }, [geo]);

  // The boat: follows the scroll, slows at each port, tilts on the bends.
  useEffect(() => {
    if (!geo || !d || !path.current) return;
    const p = path.current;
    const total = p.getTotalLength();
    const M = 900;
    const lx = new Float32Array(M + 1), ly = new Float32Array(M + 1);
    for (let i = 0; i <= M; i++) { const q = p.getPointAtLength((total * i) / M); lx[i] = q.x; ly[i] = q.y; }
    const ys = geo.pts.map((q) => q.y);
    if (trail.current) { trail.current.style.strokeDasharray = `${total}`; trail.current.style.strokeDashoffset = `${total}`; }

    const at_ = (y: number) => { // binary search the path by height
      let lo = 0, hi = M;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ly[m] < y) lo = m; else hi = m; }
      const f = ly[hi] === ly[lo] ? 0 : (y - ly[lo]) / (ly[hi] - ly[lo]);
      return {x: lx[lo] + (lx[hi] - lx[lo]) * f, len: ((lo + f) / M) * total};
    };
    const dock = (y: number) => { // linger at ports: smoothstep between each pair
      if (y <= ys[0]) return y;
      for (let i = 0; i < ys.length - 1; i++) {
        if (y < ys[i + 1]) { const t = (y - ys[i]) / (ys[i + 1] - ys[i]); return ys[i] + t * t * (3 - 2 * t) * (ys[i + 1] - ys[i]); }
      }
      return y;
    };

    let raf = 0, by = -1, bx = 0, lastAt = -2, lastReach = -1, lastLen = -9;
    const tick = (t: number) => {
      const top = box.current!.getBoundingClientRect().top;
      const raw = Math.max(0, Math.min(geo.H, innerHeight * 0.56 - top));
      const ty = dock(raw);
      if (by < 0) { by = ty; bx = at_(ty).x; }
      by += (ty - by) * (reduce ? 1 : 0.14);
      const q = at_(by);
      const vx = q.x - bx;
      bx = q.x;
      const tilt = Math.max(-14, Math.min(14, vx * 3));
      const bob = reduce ? 0 : Math.sin(t / 620) * 2.5;
      if (boat.current) {
        boat.current.style.transform = `translate(${bx}px, ${by + bob}px) rotate(${tilt}deg)`;
        boat.current.classList.toggle("moving", Math.abs(ty - by) > 2);
      }
      if (trail.current && Math.abs(q.len - lastLen) > 1) { trail.current.style.strokeDashoffset = `${total - q.len}`; lastLen = q.len; }
      if (dot.current) {
        dot.current.style.top = `${(by / geo.H) * 100}%`;
        dot.current.parentElement?.classList.toggle("done", raw > geo.H - 40 || raw < 10);
      }

      let cur = -1, reach = -1;
      ys.forEach((y, i) => {
        const gap = (ys[i + 1] ?? y + 600) - y;
        if (by >= y - gap * 0.22) cur = i;
        if (by >= y - gap * 0.4) reach = i;
      });
      if (cur !== lastAt) { if (cur > lastAt && cur >= 0) play("tick"); lastAt = cur; setAt(cur); }
      if (reach > lastReach) { lastReach = reach; setReached(reach); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [geo, d, reduce]);

  // J and K sail to the next and previous port.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = e.key === "j" ? 1 : e.key === "k" ? -1 : 0;
      if (!dir) return;
      const next = PORTS[Math.max(0, Math.min(PORTS.length - 1, at + dir))];
      const a = document.createElement("a");
      a.href = `#${next.id}`;
      document.body.appendChild(a); a.click(); a.remove();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [at]);

  return (
    <div ref={box} className={`river${geo?.narrow ? " narrow" : ""}`}>
      {geo && (
        <svg className="river-svg" width={geo.W} height={geo.H} viewBox={`0 0 ${geo.W} ${geo.H}`} aria-hidden>
          <path d={d} className="r-bank" />
          <path d={d} className="r-water" ref={path} />
          <path d={d} className="r-flow" />
          <path d={d} className="r-trail" ref={trail} />
          {geo.pts.map((q, i) => (
            <g key={i} className={`r-port${i <= at ? " lit" : ""}`} transform={`translate(${q.x} ${q.y})`}>
              <rect x={-14} y={-5} width={28} height={10} />
              <rect x={-3} y={-14} width={6} height={9} />
            </g>
          ))}
        </svg>
      )}

      {PORTS.map((p, i) => (
        <section key={p.id} id={p.id} className={`port ${i % 2 ? "odd" : "even"}`} aria-labelledby={`${p.id}-h`}>
          <PortCard p={p} i={i} active={reduce || i <= reached} here={i === at} cardRef={(el) => { cards.current[i] = el; }} />
        </section>
      ))}

      {geo && !reduce && (
        <div ref={boat} className="boat" aria-hidden>
          <div className="boat-inner">
            <Cargo stage={Math.max(0, at)} size={geo.narrow ? 36 : 48} />
            <Boat />
            <span className="wake w1" /><span className="wake w2" /><span className="wake w3" />
          </div>
        </div>
      )}

      <nav className="minimap" aria-label="Ports">
        <span className="mm-line" aria-hidden />
        {geo && PORTS.map((p, i) => (
          <a key={p.id} href={`#${p.id}`} className={`mm-port${i === at ? " on" : ""}${i <= reached ? " seen" : ""}`} style={{top: `${(geo.pts[i].y / geo.H) * 100}%`}} aria-label={`Port ${p.n}: ${p.name}`}>
            <span className="mm-label">{p.n} · {p.name}</span>
          </a>
        ))}
        <span ref={dot} className="mm-boat" aria-hidden />
        <span className="mm-keys mono" aria-hidden>J / K</span>
      </nav>
    </div>
  );
}

/** The reed boat, in pixels: a crescent hull bound with reeds, ends curled up. */
function Boat() {
  const rows: [number, number, number][] = [[0, 0, 2], [0, 18, 20], [1, 0, 2], [1, 18, 20], [2, 0, 3], [2, 17, 20], [3, 1, 19], [4, 2, 18], [5, 3, 17], [6, 5, 15]];
  return (
    <svg className="boat-svg" viewBox="0 0 20 7" width={80} height={28} shapeRendering="crispEdges">
      {rows.map(([y, a, b], k) => Array.from({length: b - a}, (_, j) => {
        const x = a + j;
        const fill = y === 3 ? "#F0B46E" : x % 3 === 0 ? "#5A3E1E" : y >= 5 ? "#8C6A3F" : "#D9924A";
        return <rect key={`${k}-${j}`} x={x} y={y} width={1} height={1} fill={fill} />;
      }))}
    </svg>
  );
}

const PortCard = ({p, i, active, here, cardRef}: {p: Port; i: number; active: boolean; here: boolean; cardRef: (el: HTMLElement | null) => void}) => {
  const [done, setDone] = useState(false);
  const reduce = useReducedMotion();
  const show = done || reduce;
  return (
    <motion.article ref={cardRef} className={`tablet-card${here ? " here" : ""}`}
                    initial={false} animate={active ? {opacity: 1, y: 0, clipPath: "inset(0% 0% 0% 0%)"} : {opacity: 0.18, y: 36, clipPath: "inset(30% 0% 0% 0%)"}}
                    transition={{duration: reduce ? 0 : 0.7, ease: [0.22, 1, 0.36, 1]}}>
      <header className="row" style={{justifyContent: "space-between", alignItems: "center"}}>
        <span className="kicker">PORT {p.n} · {p.name.toUpperCase()}</span>
        <span className="port-no display" aria-hidden>{p.n}</span>
      </header>
      <h2 id={`${p.id}-h`} className="display tablet-h"><TypeTitle pre={p.title[0]} em={p.title[1]} active={active} onDone={() => setDone(true)} /></h2>
      {/* Only the title is written; everything else arrives with it, in one soft fade. */}
      <motion.div className="tablet-rest" initial={false} animate={show ? {opacity: 1, y: 0} : {opacity: 0, y: 10}} transition={{duration: reduce ? 0 : 0.5, ease: [0.22, 1, 0.36, 1]}}>
        <p className="inscribe">{p.segs.map((s, k) => <Fragment key={k}>{typeof s === "string" ? s : s.node}</Fragment>)}</p>
        <p className="tablet-pull">{p.pull}</p>
        {p.Extra && <p.Extra />}
      </motion.div>
      <span className="sr-only">Port {i + 1} of {PORTS.length}</span>
    </motion.article>
  );
};

/** The title, written on the clay letter by letter. The emphasis word keeps its pixel face as it's written. */
function TypeTitle({pre, em, active, onDone}: {pre: string; em: string; active: boolean; onDone: () => void}) {
  const reduce = useReducedMotion();
  const total = pre.length + em.length;
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (reduce || n >= total) { if (n < total) setN(total); onDone(); return; }
    const t = setTimeout(() => setN((v) => v + 1), 38);
    return () => clearTimeout(t);
  }, [active, n, total, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = Math.min(n, pre.length), b = Math.max(0, n - pre.length);
  const writing = active && n < total;
  return (
    <>
      <span className="sr-only">{pre}{em}</span>
      <span aria-hidden>
        {pre.slice(0, a)}<span className="unwritten">{pre.slice(a)}</span>
        <span className="px-em">{em.slice(0, b)}{writing && n >= pre.length && <span className="stylus busy" />}<span className="unwritten">{em.slice(b)}</span></span>
        {writing && n < pre.length && <span className="stylus busy" style={{position: "absolute"}} />}
      </span>
    </>
  );
}

// ── What each port shows once its tablet is written ──────────────────────────────────────────

function useFeatured() {
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const s = pickFeatured(rows);
  return {rows, parity, s, q: s ? quoteFor(s, parity) : undefined};
}

function LivePrice() {
  const {rows} = useFeatured();
  const st = stocksOf(rows);
  if (!st.length) return null;
  return (
    <div className="port-extra row gap-12 wrap-row">
      {st.map((x) => (
        <div key={x.symbol} className="mini-stat"><span className="label">{stockName(x.symbol).toUpperCase()} · ONE SHARE</span><b className="num gold">{money(x.spot)}</b></div>
      ))}
    </div>
  );
}

function LiveLines() {
  const {rows} = useFeatured();
  const open = (rows ?? []).filter((r) => r.status === 0 && r.underlyingSymbol === "NVDA").sort((a, b) => Number(a.strike - b.strike));
  if (!open.length) return null;
  return (
    <div className="port-extra stack gap-8">
      <span className="label">NVIDIA LINES OPEN RIGHT NOW</span>
      <div className="row gap-8 wrap-row">{open.map((r) => <span key={r.series} className="line-chip"><b>${Math.round(n8(r.strike))}</b> ends {endShort(r.expiry)}</span>)}</div>
    </div>
  );
}

function LiveEquation() {
  const {s, q} = useFeatured();
  if (!s || !q) return null;
  return (
    <div className="port-extra eq-mini">
      <div><Relic src={RELIC.coinFloor} size={32} /><span className="label">FLOOR</span><b className="num gold">{money(q.floor)}</b></div>
      <span className="op">+</span>
      <div><Relic src={RELIC.coinUp} size={32} /><span className="label">UPSIDE</span><b className="num gold">{money(q.upside)}</b></div>
      <span className="op">≈</span>
      <div><Relic src={RELIC.coinFull} size={32} /><span className="label">1 SHARE</span><b className="num">{money(q.spot)}</b></div>
      <span className="small muted" style={{gridColumn: "1 / -1"}}>{stockName(s.underlyingSymbol)}, ${Math.round(q.strike)} line, ends {endShort(s.expiry)}. Live, from the pools.</span>
    </div>
  );
}

function Endings() {
  const K = 230;
  const [e, setE] = useState(2);
  const ends = [[190, "Falls to $190"], [230, "Ends at the line"], [300, "Rises to $300"]] as const;
  const P = ends[e][0];
  return (
    <div className="port-extra stack gap-10">
      <span className="label">EXAMPLE · A ${K} LINE</span>
      <div className="row gap-8 wrap-row">{ends.map(([, t], i) => <button key={t} className={`chip${i === e ? " on" : ""}`} onClick={() => { setE(i); play("tick"); }}>{t}</button>)}</div>
      <div className="eq-mini two">
        <div><Relic src={RELIC.coinFloor} size={28} /><span className="label">FLOOR PAYS</span><b className="num gold">{money(Math.min(P, K))}</b></div>
        <div style={{opacity: P > K ? 1 : 0.45}}><Relic src={RELIC.coinUp} size={28} /><span className="label">UPSIDE PAYS</span><b className="num gold">{money(Math.max(P - K, 0))}</b></div>
      </div>
    </div>
  );
}

function MiniTimeline() {
  const steps = ["End time", "Price carved", "One hour", "Collect"];
  return (
    <div className="port-extra mini-time" aria-label="End time, then the price is carved, then one hour to correct it, then collect">
      {steps.map((s, i) => <div key={s}><i>{["I", "II", "III", "IV"][i]}</i><span>{s}</span></div>)}
    </div>
  );
}

function LiveFeeds() {
  const {rows} = useFeatured();
  const st = stocksOf(rows);
  if (!st.length) return null;
  return (
    <div className="port-extra row gap-12 wrap-row">
      {st.map((x) => (
        <div key={x.symbol} className="mini-stat">
          <span className="label">{x.symbol}/USD</span><b className={`num ${x.fresh ? "gold" : "muted"}`}>{money(x.spot)}</b>
          <span className={`stamp ${x.fresh ? "stamp-live" : "stamp-delayed"}`} style={{fontSize: 10, alignSelf: "flex-start"}}>{x.fresh ? "LIVE" : "DELAYED"}</span>
        </div>
      ))}
    </div>
  );
}

function LiveParity() {
  const {s, q, parity} = useFeatured();
  const p = s ? parity?.[s.series.toLowerCase()] : undefined;
  if (!q || !p) return null;
  const gap = Number(p.gapBps) / 100;
  return (
    <div className="port-extra stack gap-8">
      <span className="label">LIVE · {s!.underlyingSymbol} ${Math.round(q.strike)}</span>
      <span className="num" style={{fontSize: 16}}>Floor + Upside <b className="gold">{money(q.floor + q.upside)}</b> · Share <b>{money(q.spot)}</b> · Gap {gap.toFixed(2)}%</span>
      <span className="small muted">Testnet pools are thin and trade rarely, so gaps here can sit open until the next trade. Open the deep dive to see how a trade closes one.</span>
    </div>
  );
}

function Risks() {
  return (
    <div className="port-extra risk-cols">
      <div><span className="label down">CAN HAPPEN</span><ul><li>The Upside ends at $0</li><li>The Floor falls with the stock</li><li>Prices shift up to 0.5% before an order lands</li></ul></div>
      <div><span className="label up">CAN&apos;T HAPPEN</span><ul><li>Borrowing or margin calls</li><li>Anyone force-selling your halves</li><li>Aarka setting the final price</li></ul></div>
    </div>
  );
}

// ── The harbour ──────────────────────────────────────────────────────────────────────────────

const FAQ: [string, string][] = [
  ["Can I lose money?", "Yes. The Upside can end at $0, and the Floor falls if the stock falls. Only use money you're comfortable losing. Practice shares let you learn with nothing at stake."],
  ["Can I undo a split?", "Yes. Hold a Floor and an Upside from the same split and you can put them back together into one share at any moment, even after the end date."],
  ["What happens if I forget to collect?", "Nothing bad. Your payout waits for you. There's no deadline and no fee for waiting."],
  ["Can anyone force-sell my position?", "No. There's no borrowing, so there are no margin calls. Your pieces stay yours until you act or the end date arrives."],
  ["Who sets the final price?", "The Sun, an independent public price source. Nobody at Aarka can change it."],
  ["What does it cost?", "A small network fee each time you act; on this testnet it's paid in testnet ETH. Buying or selling a piece also pays the pool's 0.3% fee, and the price may shift by up to 0.5% before your order completes."],
];

function Harbour() {
  const [open, setOpen] = useState(0);
  return (
    <section className="harbour rule-top">
      <div className="wrap harbour-in">
        <div className="stack gap-24">
          <span className="kicker">THE HARBOUR</span>
          <h2 className="display h-sub">The river ends here. <span className="em">Your turn.</span></h2>
          <p className="lead" style={{maxWidth: 480}}>Pick a half with free practice shares. It takes about a minute, and nothing is real money.</p>
          <TeleportLink href="/app" className="btn btn-primary btn-lg" style={{alignSelf: "flex-start"}}>Choose your half →</TeleportLink>
        </div>
        <div className="asked">
          <span className="label">ASKED OFTEN</span>
          <div className="asked-grid">
            <ul className="asked-list" role="tablist" aria-label="Questions">
              {FAQ.map(([q], i) => (
                <li key={q}>
                  <button role="tab" aria-selected={open === i} className={open === i ? "on" : ""} onClick={() => { setOpen(i); play("tick"); }}>
                    <span className="mono">{String(i + 1).padStart(2, "0")}</span>{q}
                  </button>
                  {/* On a phone the answer sits right under its question. */}
                  {open === i && <motion.p className="asked-inline body" initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 0.3}}>{FAQ[i][1]}</motion.p>}
                </li>
              ))}
            </ul>
            <div className="asked-answer" role="tabpanel">
              <motion.div key={open} initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} transition={{duration: 0.3, ease: [0.22, 1, 0.36, 1]}}>
                <span className="kicker">{String(open + 1).padStart(2, "0")}</span>
                <h3 className="display" style={{fontSize: 28, lineHeight: 1.1}}>{FAQ[open][0]}</h3>
                <p className="body">{FAQ[open][1]}</p>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
