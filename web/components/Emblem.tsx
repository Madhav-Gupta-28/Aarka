"use client";

/**
 * A pixel emblem for each stock, drawn on the same grid as the relics: a chip for NVIDIA, a bolt
 * for Tesla. Generic pictures, not the companies' logos.
 */

export const BOLT = [
  "........#####...",
  ".......#####....",
  "......#####.....",
  ".....#####......",
  "....#####.......",
  "...###########..",
  "..###########...",
  ".......#####....",
  "......#####.....",
  ".....#####......",
  "....####........",
  "...###..........",
  "..##............",
  ".#..............",
];

function chip(): string[] {
  const g = Array.from({length: 16}, () => Array(16).fill("."));
  for (let y = 2; y <= 13; y++) for (let x = 2; x <= 13; x++) if (x === 2 || x === 13 || y === 2 || y === 13) g[y][x] = "#";
  for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) g[y][x] = "o";
  for (const p of [4, 6, 8, 10, 12]) { g[0][p] = g[1][p] = g[14][p] = g[15][p] = "+"; g[p][0] = g[p][1] = g[p][14] = g[p][15] = "+"; }
  g[3][3] = "o";
  return g.map((r) => r.join(""));
}
export const CHIP = chip();

const FILL: Record<string, string> = {"#": "#D9924A", o: "#F0B46E", "+": "#8C6A3F"};

export function Emblem({sym, size, className, style}: {sym: string; size: number; className?: string; style?: React.CSSProperties}) {
  const art = sym === "TSLA" ? BOLT : CHIP;
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" className={className} style={style} aria-hidden>
      {art.flatMap((row, y) => row.split("").map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y + (art.length < 16 ? 1 : 0)} width={1} height={1} fill={FILL[c] ?? FILL["#"]} />)))}
    </svg>
  );
}
