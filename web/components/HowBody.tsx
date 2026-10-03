"use client";

import {AnimatePresence, motion} from "motion/react";
import {useEffect, useRef, useState} from "react";
import {GearAnim, Relic, Reveal, SunAnim} from "./Relic";
import {ADDRESSES, MARKETS} from "@/lib/contracts";
import {pickFeatured, quoteFor, stocksOf, useParityAll, useSeries} from "@/lib/data";
import {ago, endShort, lineLabel, money, short, stockName} from "@/lib/format";
import {RELIC} from "@/lib/relics";
import {explorerAddr} from "@/lib/tx";
import {spot, useReducedMotion} from "@/lib/ui";

/**
 * How it works, as four pictures that move. Each one carries a single idea and should land
 * without reading a word: a share goes in and two halves come out; drag the final price and watch
 * who gets what; a push on one side of the scales is undone in the same breath; the close, the
 * price, the stone, the payout. Three questions a judge asks next, then the full mechanism for
 * anyone who wants to check it.
 */

/** A phase counter that steps on its own while the picture is on screen, and holds still otherwise. */
function useLoop(n: number, ms: number, hold = 0) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(hold);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return setSeen(true);
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), {threshold: 0.3});
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (reduce || !seen) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms, reduce, seen]);
  return {i: reduce ? hold : i, ref, reduce};
}

function Pic({n, id, title, line, children}: {n: string; id: string; title: React.ReactNode; line: string; children: React.ReactNode}) {
  return (
    <section id={id} className="section-tight rule-top pic" style={{scrollMarginTop: 24}}>
      <div className="wrap pic-grid">
        <Reveal className="stack gap-12 pic-copy">
          <span className="pic-n">{n}</span>
          <h2 className="display h-sub">{title}</h2>
          <p className="lead">{line}</p>
        </Reveal>
        <Reveal delay={120} className="pic-art">{children}</Reveal>
      </div>
    </section>
  );
}

// ── 01 · In and out ────────────────────────────────────────────────────────────────────────────

const SPLIT_STEPS = ["1 share", "goes in", "2 halves come out", "put both back, get your share"];

function SplitAnim() {
  const {i, ref} = useLoop(4, 1500, 2);
  // x positions as a percentage of the stage width
  const share = [{left: "8%", scale: 1, opacity: 1}, {left: "42%", scale: 0.55, opacity: 0}, {left: "42%", scale: 0.55, opacity: 0}, {left: "8%", scale: 1, opacity: 1}][i];
  const out = i === 2;
  return (
    <div ref={ref} className="anim card spot" {...spot}>
      <div className="split-stage">
        <motion.div className="sp-vault" animate={{scale: i === 1 || i === 3 ? 1.08 : 1}} transition={{type: "spring", stiffness: 300, damping: 14}}>
          <Relic name="lock" size={56} />
          <span>THE VAULT</span>
        </motion.div>
        <motion.div className="sp-coin" style={{top: "26%"}} animate={share} transition={{duration: 0.7, ease: [0.2, 0.7, 0.2, 1]}}>
          <Relic name="coinFull" size={96} />
        </motion.div>
        <motion.div className="sp-coin" style={{top: "4%"}} animate={{left: out ? "74%" : "44%", opacity: out ? 1 : 0, scale: out ? 1 : 0.5}} transition={{duration: 0.6, ease: [0.2, 0.7, 0.2, 1]}}>
          <Relic name="coinFloor" size={76} /><b>FLOOR</b>
        </motion.div>
        <motion.div className="sp-coin" style={{top: "50%"}} animate={{left: out ? "74%" : "44%", opacity: out ? 1 : 0, scale: out ? 1 : 0.5}} transition={{duration: 0.6, delay: 0.08, ease: [0.2, 0.7, 0.2, 1]}}>
          <Relic name="coinUp" size={76} /><b>UPSIDE</b>
        </motion.div>
      </div>
      <div className="anim-steps">
        {SPLIT_STEPS.map((s, k) => <span key={s} className={k === i ? "on" : ""}>{s}</span>)}
      </div>
    </div>
  );
}

// ── 02 · Drag the final price ──────────────────────────────────────────────────────────────────

const MAX = 320;

function PayoffDrag({K}: {K: number}) {
  const reduce = useReducedMotion();
  const [p, setP] = useState(300);
  const [touched, setTouched] = useState(false);
  // Sweep the price slowly until someone takes hold of it.
  useEffect(() => {
    if (reduce || touched) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const s = (Math.sin((t - t0) / 1400) + 1) / 2;
      setP(Math.round(130 + s * 170));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduce, touched]);
  const f = Math.min(p, K), u = Math.max(p - K, 0);
  const pct = (v: number) => `${(v / MAX) * 100}%`;
  return (
    <div className="anim card spot" {...spot}>
      <div className="pd-totals">
        <div><span className="label">FLOOR GETS</span><b className="num gold">{money(f, 0)}</b></div>
        <div className={u ? "" : "dim"}><span className="label">UPSIDE GETS</span><b className="num gold">{money(u, 0)}</b></div>
      </div>
      <div className="pd-track">
        <span className="pd-floor" style={{width: pct(f)}} />
        <span className="pd-up" style={{left: pct(K), width: pct(u)}} />
        <span className="pd-line" style={{left: pct(K)}}><i>LINE ${K}</i></span>
        <span className="pd-sun" style={{left: pct(p)}}><SunAnim size={44} /><i>${p}</i></span>
        <input type="range" min={100} max={MAX} value={p} aria-label="Final price"
               onChange={(e) => { setTouched(true); setP(Number(e.target.value)); }} />
      </div>
      <p className="pd-say">
        {p < K ? <>Below the line: the <b>Floor</b> gets it all, the Upside gets nothing.</>
          : p === K ? <>On the line: the <b>Floor</b> gets ${K}. Nothing above it.</>
            : <>Above the line: the Floor stops at ${K}. The <b>Upside</b> gets the ${u} above.</>}
      </p>
      <span className="mono muted pd-hint">{touched ? `$${p} = $${f} + $${u}, always one share` : "DRAG THE SUN ↔"}</span>
    </div>
  );
}

// ── 03 · The scales ────────────────────────────────────────────────────────────────────────────

const SCALE_STEPS = [
  {t: "Balanced", d: "Floor + Upside = one share."},
  {t: "A big trade", d: "Someone buys Floors. The halves cost more than the share."},
  {t: "The hook acts", d: "Same transaction: it buys a share, splits it, sells both halves."},
  {t: "Balanced again", d: "The profit goes to the pool's liquidity providers."},
];

function ScalesAnim({floor, upside, sum, gap}: {floor?: number; upside?: number; sum?: number; gap?: bigint}) {
  const {i, ref} = useLoop(4, 1900, 0);
  const tilt = i === 1 ? -9 : i === 2 ? -4 : 0;
  const lift = Math.sin((tilt * Math.PI) / 180) * 140;
  return (
    <div ref={ref} className="anim card spot" {...spot}>
      <div className="sc-stage">
        <AnimatePresence>{i === 2 && (
          <motion.div className="sc-hook" initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}}>
            <GearAnim size={40} big /><span>UNISWAP V4 HOOK</span>
          </motion.div>
        )}</AnimatePresence>
        <motion.div className="sc-beam" animate={{rotate: tilt}} transition={{type: "spring", stiffness: 120, damping: 12}} />
        <span className="sc-post" />
        <motion.div className="sc-pan left" animate={{y: -lift}} transition={{type: "spring", stiffness: 120, damping: 12}}>
          <div className="row" style={{gap: 2}}><Relic name="coinFloor" size={44} /><Relic name="coinUp" size={44} /></div>
          <span className="sc-dish" />
          <b>FLOOR + UPSIDE</b>
        </motion.div>
        <motion.div className="sc-pan right" animate={{y: lift}} transition={{type: "spring", stiffness: 120, damping: 12}}>
          <Relic name="coinFull" size={52} />
          <span className="sc-dish" />
          <b>ONE SHARE</b>
        </motion.div>
      </div>
      <div className="anim-steps four">
        {SCALE_STEPS.map((s, k) => <span key={s.t} className={k === i ? "on" : ""}>{s.t}</span>)}
      </div>
      <p className="pd-say">{SCALE_STEPS[i].d}</p>
      <span className="mono muted pd-hint">
        LIVE · {floor !== undefined ? `${money(floor)} + ${money(upside!)} = ${money(sum!)}` : "reading the pools…"}{gap !== undefined ? ` · GAP ${gap.toString()} BPS` : ""}
      </span>
    </div>
  );
}

// ── 04 · The final day ─────────────────────────────────────────────────────────────────────────

const DAY = [
  {img: RELIC.astro(0.95), t: "The close", d: "4:00 PM New York on the end date."},
  {img: RELIC.sun, t: "The price", d: "Chainlink's last price at or before the close."},
  {img: RELIC.stele, t: "Carved", d: "Anyone writes it on-chain. A one-hour check, then it's final."},
  {img: RELIC.coinFull, t: "Collect", d: "Floor and Upside pay out in the stock itself. No deadline."},
];

function DayAnim() {
  const {i, ref} = useLoop(4, 1700, 3);
  return (
    <div ref={ref} className="anim card spot" {...spot}>
      <div className="day-track">
        <motion.span className="day-fill" animate={{width: `${(i / 3) * 100}%`}} transition={{duration: 0.8, ease: [0.2, 0.7, 0.2, 1]}} />
        {DAY.map((s, k) => (
          <motion.div key={s.t} className={`day-stop${k <= i ? " lit" : ""}`} animate={{scale: k === i ? 1.18 : 1, y: k === i ? -6 : 0}} transition={{type: "spring", stiffness: 260, damping: 16}}>
            <span className="day-icon"><Relic src={s.img} size={52} /></span>
            <b>{s.t}</b>
          </motion.div>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.p key={i} className="pd-say" initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -6}} transition={{duration: 0.25}}>
          {DAY[i].d}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

// ── The page ───────────────────────────────────────────────────────────────────────────────────

const FAQ: [string, React.ReactNode][] = [
  ["Isn’t this just an option? Who’s on the other side?",
   <>Nobody. There’s no option writer, no margin and no liquidation. Every Floor and Upside pair is backed by exactly one share locked in the series contract, and the payoffs add up to that one share at every price, so the vault can always pay. The AMM is the market for each half.</>],
  ["Why would the two halves stay priced right?",
   <>Because anyone can split a share into a pair, or put a pair back into a share, at 1:1. If the halves drift from the share’s price, that’s free money, and the hook takes it inside the same swap, then gives it to the liquidity providers.</>],
  ["What if the price feed is late, wrong, or gamed?",
   <>Settlement can only pin one specific Chainlink round: the last one at or before the close. A later valid round can replace it within an hour, and after a week a stale feed is accepted so nothing is stranded. Nobody, including us, can set a price. Putting pairs back together never stops working.</>],
];

export function HowBody() {
  const {data: rows} = useSeries();
  const {data: parity} = useParityAll(rows);
  const stocks = stocksOf(rows);
  const s = pickFeatured(rows);
  const q = s ? quoteFor(s, parity) : undefined;
  const p = s ? parity?.[s.series.toLowerCase()] : undefined;
  const K = q ? Math.round(q.strike) : 210;
  const [open, setOpen] = useState<number | null>(0);
  const [tech, setTech] = useState(false);
  const hook = s ? MARKETS[s.series.toLowerCase()] : undefined;

  return (
    <div className="gridlines">
      <section className="wrap how-top">
        <span className="kicker">HOW IT WORKS · FOUR PICTURES</span>
        <h1 className="display h-xl rise">One share.<br /><span className="px-em">Two halves.</span></h1>
        <p className="lead">Watch each picture for a few seconds. That’s the whole protocol.</p>
      </section>

      <Pic n="01" id="halves" title="Put a share in. Get two halves out." line="Every split is reversible. Put a Floor and an Upside back in and your share comes out.">
        <SplitAnim />
      </Pic>

      <Pic n="02" id="endings" title={<>Drag the final price.</>} line={`The Floor gets the share’s value up to the $${K} line. The Upside gets everything above it.`}>
        <PayoffDrag K={K} />
      </Pic>

      <Pic n="03" id="scales" title="Always adds up." line="If the halves drift from the share, a hook puts them back in the same transaction.">
        <ScalesAnim floor={q?.floor} upside={q?.upside} sum={q ? q.floor + q.upside : undefined} gap={p?.gapBps} />
      </Pic>

      <Pic n="04" id="sun" title="The final day." line="The price at the close is carved in stone. Then you collect.">
        <div className="stack gap-16">
          <DayAnim />
          <div className="row gap-12 wrap-row">
            {stocks.map((st) => (
              <span key={st.symbol} className={`stamp ${st.fresh ? "stamp-live" : "stamp-delayed"}`}>
                {stockName(st.symbol)} {st.spot ? money(st.spot) : "—"} · {st.fresh ? "LIVE" : "DELAYED"} · {ago(st.updatedAt)}
              </span>
            ))}
          </div>
        </div>
      </Pic>

      <section id="risks" className="section-tight rule-top" style={{scrollMarginTop: 24}}>
        <div className="wrap how-faq">
          <span className="kicker">THE QUESTIONS YOU’LL ASK</span>
          <div className="stack faq">
            {FAQ.map(([qq, a], k) => (
              <div key={qq}>
                <button aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>{qq}<span>{open === k ? "−" : "+"}</span></button>
                {open === k && <p>{a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap" style={{paddingBottom: 96}}>
        <div className="drawer tech">
          <button aria-expanded={tech} onClick={() => setTech(!tech)} style={{height: 64}}><span>TECHNICAL DETAILS · FOR EXPERTS</span><span>{tech ? "HIDE ▴" : "SHOW ▾"}</span></button>
          {tech && (
            <div className="tech-body">
              <h4>Payoff and solvency · AarkaSeries</h4>
              <dl>
                <dt>Floor payout</dt><dd><code>fp = mulDiv(min(P, K), 1e18, P)</code>, floored. Per unit, in the underlying.</dd>
                <dt>Upside payout</dt><dd><code>1e18 − fp</code>. Computed as the exact complement, so <code>fp + up = 1e18</code> is an identity, not a property.</dd>
                <dt>Mint</dt><dd>Mints against the observed balance delta, so the supply invariant holds even for a fee-on-transfer token. Closed at expiry.</dd>
                <dt>Redeem</dt><dd>1 Floor + 1 Upside → 1 underlying. Never disabled: before, after expiry, after settlement, or with a dead oracle.</dd>
                <dt>Claims</dt><dd>Burn, then <code>mulDiv(amount, payout, 1e18)</code> rounded down; dust stays in the vault. Zero payouts burn without transferring.</dd>
                <dt>Invariants</dt><dd>Payouts sum to one; vault always solvent; no value created; terms immutable. 5 invariants over 2.25M random calls.</dd>
              </dl>
              <h4>Settlement</h4>
              <dl>
                <dt>settle(roundId)</dt><dd>Caller names a round; the contract proves it: <code>updatedAt ≤ expiry</code>, <code>expiry − updatedAt ≤ 26h</code>, and round <code>id + 1</code> either reverts (Chainlink phase boundary, caught) or is after expiry.</dd>
                <dt>Guards</dt><dd>8-decimal feed asserted; L2 sequencer uptime with a 1-hour grace period; ERC-8056 <code>oraclePaused()</code> and a corporate action effective after the round both block the normal path.</dd>
                <dt>Challenge</dt><dd>1 hour. Any strictly later round still ≤ expiry replaces the price. Monotone and bounded: <code>claimsUnlockAt</code> never extends.</dd>
                <dt>Late path</dt><dd>7 days after expiry, only round pinning and decimals are checked, so every series resolves. Recorded as <code>settledLate</code>.</dd>
              </dl>
              <h4>Parity hook · AarkaParityHook (Uniswap v4)</h4>
              <dl>
                <dt>Trigger</dt><dd><code>afterSwap</code> on the three wired pools only. Acts when <code>|P_f + P_u − P_N| / P_N ≥ 100 bps</code> (above the ~90 bps three pool fees cost).</dd>
                <dt>Sizing</dt><dd>Binary search, 20 steps, for the size where <code>P_f + P_u = P_N</code>, which is also the profit-maximising size. Capped by <code>maxArbSize</code>, half the virtual reserve and the PoolManager’s real balance.</dd>
                <dt>Execution</dt><dd>Inside the caller’s unlock with flash accounting: halves dear → buy share, mint, sell both; halves cheap → buy both, redeem, sell share. Self-call in try/catch; reverts unless profit &gt; 0 and every currency delta is flat, so a failed arb never touches the user’s swap.</dd>
                <dt>Profit</dt><dd>Donated to the in-range LPs of the triggering pool. Liquidity must stay 1 hour (<code>beforeRemoveLiquidity</code>) so it can’t be sniped just in time. Permission bits <code>0x640</code>.</dd>
              </dl>
              <h4>Factory and governance</h4>
              <dl>
                <dt>Creation</dt><dd>Permissionless in (strike, expiry): whole-cent strikes within 5× of spot, expiries from a published NYSE calendar, 1 day to 1 year. The price feed is the one governed input, per asset.</dd>
                <dt>Admin</dt><dd>No proxies, no upgrades, no pause on user funds, no price override. A feed change reaches only series created afterwards.</dd>
              </dl>
              <h4>Deployment · Robinhood Chain testnet (46630)</h4>
              <dl>
                <dt>Factory</dt><dd><a href={explorerAddr(ADDRESSES.factory)} target="_blank" rel="noreferrer">{short(ADDRESSES.factory)}</a> · Lens <a href={explorerAddr(ADDRESSES.lens)} target="_blank" rel="noreferrer">{short(ADDRESSES.lens)}</a> · Router <a href={explorerAddr(ADDRESSES.router)} target="_blank" rel="noreferrer">{short(ADDRESSES.router)}</a></dd>
                {s && hook && <><dt>{s.underlyingSymbol} ${lineLabel(n8s(s.strike))} · {endShort(s.expiry)}</dt><dd>Series <a href={explorerAddr(s.series)} target="_blank" rel="noreferrer">{short(s.series)}</a> · Hook <a href={explorerAddr(hook)} target="_blank" rel="noreferrer">{short(hook)}</a></dd></>}
                <dt>Feeds</dt><dd>{stocks.map((st, k) => <span key={st.symbol}>{k ? " · " : ""}<a href={explorerAddr(st.feed)} target="_blank" rel="noreferrer">{st.symbol}/USD {short(st.feed)}</a></span>)} · real mainnet Chainlink prices, mirrored with their timestamps</dd>
                <dt>Assurance</dt><dd>213 unit, fuzz and invariant tests, fork tests against Robinhood mainnet; four review rounds (AUDIT-01 to 29); all 71 contracts verified. <a href="https://github.com/Madhav-Gupta-28/Aarka" target="_blank" rel="noreferrer">Source and audit ↗</a></dd>
              </dl>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const n8s = (v: bigint) => Number(v) / 1e8;
