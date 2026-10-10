"use client";

import {motion} from "motion/react";
import {useMemo} from "react";
import {useHistory} from "@/lib/history";
import {money, plural, qty} from "@/lib/format";
import {reference} from "@/lib/pricing";

/**
 * Rewind: the same choice, made at the start of The Sun's record, ending today. The price path is
 * real, read from the feed. What the Upside would have cost back then isn't on record, so that
 * part uses the reference model, and the card says so.
 */
export function Rewind({feed, name, intent, n, ratio}: {feed?: `0x${string}`; name: string; intent: "earn" | "bet"; n: number; ratio: number}) {
  const {data: pts, isLoading} = useHistory(feed);

  const r = useMemo(() => {
    if (!pts || pts.length < 2) return null;
    const a = pts[0], b = pts[pts.length - 1];
    const K = a.price * ratio;
    const T = b.at - a.at;
    const up0 = reference(a.price, K, T).upside;
    const P = b.price;
    const days = Math.round(T / 86400);
    if (intent === "earn") {
      const cash = n * up0, kept = n * Math.min(P, K);
      return {a, b, K, days, P, cash, now: kept + cash, hold: n * P, up0};
    }
    const pieces = up0 > 0 ? n / up0 : 0;
    return {a, b, K, days, P, pieces, now: pieces * Math.max(P - K, 0), hold: n, up0};
  }, [pts, ratio, intent, n]);

  // The sparkline: the real path, the line, where it started and where it is.
  const W = 640, H = 150, pad = 10;
  const path = useMemo(() => {
    if (!pts || !r) return null;
    const lo = Math.min(r.K, ...pts.map((p) => p.price)) * 0.985, hi = Math.max(r.K, ...pts.map((p) => p.price)) * 1.015;
    const X = (t: number) => pad + ((t - pts[0].at) / (pts[pts.length - 1].at - pts[0].at)) * (W - pad * 2);
    const Y = (p: number) => H - pad - ((p - lo) / (hi - lo)) * (H - pad * 2);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.at).toFixed(1)} ${Y(p.price).toFixed(1)}`).join(" ");
    return {d, area: `${d} L${X(pts[pts.length - 1].at)} ${H} L${X(pts[0].at)} ${H} Z`, ky: Y(r.K), sx: X(pts[0].at), sy: Y(pts[0].price), ex: X(pts[pts.length - 1].at), ey: Y(pts[pts.length - 1].price)};
  }, [pts, r]);

  const since = r ? new Date(r.a.at * 1000).toLocaleDateString("en-US", {month: "short", day: "numeric"}) : "";
  const better = r ? r.now >= r.hold - 0.005 : false;

  return (
    <section className="rewind" aria-label="Rewind">
      <div className="rewind-head">
        <span className="kicker">REWIND · IF YOU&apos;D DONE THIS {r ? `${r.days} DAYS AGO` : "BEFORE"}</span>
        <h2 className="display">What it would have <span className="em">paid.</span></h2>
      </div>
      {isLoading || !r || !path ? (
        <div className="skel" style={{height: 220}} />
      ) : (
        <div className="rewind-body">
          <div className="rewind-chart">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${name} from ${money(r.a.price)} on ${since} to ${money(r.P)} today, with the line at ${money(r.K, 0)}`}>
              <defs><linearGradient id="rw" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#D9924A" stopOpacity=".28" /><stop offset="1" stopColor="#D9924A" stopOpacity="0" /></linearGradient></defs>
              <motion.path d={path.area} fill="url(#rw)" initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 0.8}} />
              <line x1={0} x2={W} y1={path.ky} y2={path.ky} stroke="#F0B46E" strokeDasharray="4 5" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              <motion.path d={path.d} fill="none" stroke="#F7E2BF" strokeWidth={2} vectorEffect="non-scaling-stroke" initial={{pathLength: 0}} animate={{pathLength: 1}} transition={{duration: 1.4, ease: [0.22, 1, 0.36, 1]}} />
              <circle cx={path.sx} cy={path.sy} r={4} fill="#8C6A3F" />
              <circle cx={path.ex} cy={path.ey} r={5} fill="#F0B46E" />
            </svg>
            <div className="rewind-axis mono"><span>{since} · {money(r.a.price)}</span><span className="gold">line {money(r.K, 0)}</span><span>today · {money(r.P)}</span></div>
          </div>
          <div className="rewind-out">
            {intent === "earn" ? (
              <>
                <div><span className="label">YOU&apos;D HAVE TAKEN, ON {since.toUpperCase()}</span><b className="num gold">{money(r.cash ?? 0)}</b><small>cash, for {qty(n)} {name} {plural(n, "Upside")}</small></div>
                <div><span className="label">TODAY YOU&apos;D HAVE</span><b className={`num ${better ? "up" : "down"}`}>{money(r.now)}</b><small>{qty(n)} {plural(n, "Floor")} at up to {money(r.K, 0)}, plus the cash</small></div>
                <div><span className="label">JUST HOLDING</span><b className="num">{money(r.hold)}</b><small>{qty(n)} {name} {plural(n, "share")}</small></div>
              </>
            ) : (
              <>
                <div><span className="label">YOU&apos;D HAVE BOUGHT, ON {since.toUpperCase()}</span><b className="num gold">{qty(r.pieces ?? 0, 2)}</b><small>Upsides for {money(n)}, at about {money(r.up0)} each</small></div>
                <div><span className="label">TODAY THEY&apos;D PAY</span><b className={`num ${better ? "up" : "down"}`}>{money(r.now)}</b><small>{r.P > r.K ? `${money(r.P - r.K)} each, above the line` : "nothing: it's below the line"}</small></div>
                <div><span className="label">YOU PAID</span><b className="num">{money(r.hold)}</b><small>the most you could lose</small></div>
              </>
            )}
          </div>
          <p className="rewind-note small muted">The {name} prices are real, from The Sun&apos;s record since {since}. What the Upside would have cost then isn&apos;t on record, so it&apos;s our reference model (40% volatility). Past prices don&apos;t predict future ones.</p>
        </div>
      )}
    </section>
  );
}
