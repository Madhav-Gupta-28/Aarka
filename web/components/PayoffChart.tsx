"use client";

import {useMemo, useState} from "react";

type Props = {
  /** Strike, 8 decimals, matching the Chainlink feed. */
  strike: bigint;
  /** Current spot, 8 decimals. Drawn as a marker if present. */
  spot?: bigint;
  underlyingSymbol: string;
  /** Settlement price, 8 decimals, once the series has settled. */
  settlementPrice?: bigint;
  height?: number;
};

const W = 560;

/**
 * The two payoffs, drawn.
 *
 * The floor takes min(S, K) — it tracks the share up to the strike and then flattens.
 * The upside takes max(0, S - K) — nothing until the strike, then everything above it.
 *
 * Drawn in USD rather than in units of the underlying, because that is the shape people already
 * know from an option payoff diagram. The vertical distance between the two lines at any price is
 * the whole product: what one holder gave up is exactly what the other received.
 */
export function PayoffChart({strike, spot, underlyingSymbol, settlementPrice, height = 260}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const K = Number(strike) / 1e8;
  const S = spot ? Number(spot) / 1e8 : undefined;
  const settled = settlementPrice ? Number(settlementPrice) / 1e8 : undefined;

  // Domain: zero to twice the strike, so the cap and the ramp are both clearly visible.
  const xMax = K * 2;
  const yMax = K * 2;
  const pad = {l: 46, r: 18, t: 18, b: 34};
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const x = (v: number) => pad.l + (v / xMax) * iw;
  const y = (v: number) => pad.t + ih - (v / yMax) * ih;

  const floorPath = `M ${x(0)} ${y(0)} L ${x(K)} ${y(K)} L ${x(xMax)} ${y(K)}`;
  const upsidePath = `M ${x(0)} ${y(0)} L ${x(K)} ${y(0)} L ${x(xMax)} ${y(xMax - K)}`;

  const marker = settled ?? S;
  const readout = useMemo(() => {
    const p = hover ?? marker;
    if (p === undefined) return null;
    return {price: p, floor: Math.min(p, K), upside: Math.max(0, p - K)};
  }, [hover, marker, K]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const v = ((px - pad.l) / iw) * xMax;
    setHover(v > 0 && v < xMax ? v : null);
  }

  const ticks = [0, K / 2, K, K * 1.5, xMax];

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Payoff of the floor and upside halves of ${underlyingSymbol} at a $${K} strike`}
      >
        {/* the strike, the only vertical reference that matters */}
        <line x1={x(K)} y1={pad.t} x2={x(K)} y2={pad.t + ih} className="strike" />
        <text x={x(K)} y={pad.t - 5} className="strikeLabel" textAnchor="middle">
          strike ${K.toFixed(0)}
        </text>

        {/* axes */}
        <line x1={pad.l} y1={pad.t + ih} x2={pad.l + iw} y2={pad.t + ih} className="axis" />
        {ticks.filter((t) => marker === undefined || Math.abs(t - marker) > xMax * 0.08).map((t) => (
          <text key={t} x={x(t)} y={height - 12} className="tick" textAnchor="middle">
            ${t.toFixed(0)}
          </text>
        ))}
        {[0, K, yMax].map((t) => (
          <text key={`y${t}`} x={pad.l - 8} y={y(t) + 4} className="tick" textAnchor="end">
            ${t.toFixed(0)}
          </text>
        ))}

        <path d={floorPath} className="floor" />
        <path d={upsidePath} className="upside" />

        {marker !== undefined && (
          <>
            <line x1={x(marker)} y1={pad.t} x2={x(marker)} y2={pad.t + ih} className="marker" />
            <text x={x(marker)} y={pad.t + ih + 22} className="markerLabel" textAnchor="middle">
              {settled ? "settled" : "now"} ${marker.toFixed(2)}
            </text>
          </>
        )}

        {readout && (
          <>
            <circle cx={x(readout.price)} cy={y(readout.floor)} r={4} className="dotFloor" />
            <circle cx={x(readout.price)} cy={y(readout.upside)} r={4} className="dotUpside" />
          </>
        )}
      </svg>

      <div className="legend">
        <span className="key">
          <i className="swFloor" /> floor
          <b>{readout ? `$${readout.floor.toFixed(2)}` : "min(price, strike)"}</b>
        </span>
        <span className="key">
          <i className="swUpside" /> upside
          <b>{readout ? `$${readout.upside.toFixed(2)}` : "everything above"}</b>
        </span>
        {readout && (
          <span className="sum">
            together <b>${(readout.floor + readout.upside).toFixed(2)}</b> — one whole share
          </span>
        )}
      </div>
    </div>
  );
}
