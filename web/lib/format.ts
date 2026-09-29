/// On-chain units: prices from the feeds carry 8 decimals, tokens 18, USDG 6.
export const n8 = (v: bigint) => Number(v) / 1e8;
export const n18 = (v: bigint) => Number(v) / 1e18;
export const n6 = (v: bigint) => Number(v) / 1e6;

export const usd = (v: bigint, dp = 2) => money(n8(v), dp);

export const units = (v: bigint, dp = 2) =>
  n18(v).toLocaleString("en-US", {maximumFractionDigits: dp});

/** Payout ratios are 18-decimal fractions of one underlying token. */
export const pct = (v: bigint) => `${(n18(v) * 100).toFixed(1)}%`;

/** Dollars first, always: "$1,240.00". */
export function money(v: number, dp = 2) {
  if (!Number.isFinite(v)) return "—";
  const s = Math.abs(v).toLocaleString("en-US", {minimumFractionDigits: dp, maximumFractionDigits: dp});
  return (v < 0 ? "−$" : "$") + s;
}

/** A count of shares or pieces, without trailing zeros: 1, 2.5, 0.0125. */
export function qty(v: number, dp = 4) {
  if (!Number.isFinite(v)) return "0";
  return v.toLocaleString("en-US", {maximumFractionDigits: dp});
}

export const plural = (n: number, one: string, many = one + (one === one.toUpperCase() ? "S" : "s")) => (n === 1 ? one : many);

/** "▲ +$3.56" / "▼ −$1.20": up and down always carry an arrow and a sign, never colour alone. */
export function delta(v: number, dp = 2) {
  if (Math.abs(v) < 0.005) return "= today";
  return (v > 0 ? "▲ +" : "▼ −") + money(Math.abs(v), dp);
}

const NY = "America/New_York";

export function expiryLabel(ts: bigint) {
  return new Date(Number(ts) * 1000).toLocaleDateString("en-US", {
    day: "2-digit", month: "short", year: "numeric", timeZone: NY,
  });
}

/** "Oct 30" */
export const endShort = (ts: bigint) =>
  new Date(Number(ts) * 1000).toLocaleDateString("en-US", {month: "short", day: "numeric", timeZone: NY});

/** "Oct 30, 2026" */
export const endLong = (ts: bigint) =>
  new Date(Number(ts) * 1000).toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric", timeZone: NY});

/** "30OCT26", the way the tokens are named. */
export function endCode(ts: bigint) {
  const d = new Date(Number(ts) * 1000);
  const p = new Intl.DateTimeFormat("en-US", {day: "2-digit", month: "short", year: "2-digit", timeZone: NY}).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")}${get("month").toUpperCase()}${get("year")}`;
}

/** "4:00 PM New York time" */
export const endTime = (ts: bigint) =>
  new Date(Number(ts) * 1000).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit", timeZone: NY}) + " New York time";

export const nowSec = () => Math.floor(Date.now() / 1000);

export function secondsLeft(ts: bigint) {
  return Math.max(0, Number(ts) - nowSec());
}

export function countdown(ts: bigint) {
  const s = secondsLeft(ts);
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d > 0 ? `${d}d ${String(h).padStart(2, "0")}h` : `${h}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** "Ends in 33 days 4 hrs" */
export function countdownWords(ts: bigint) {
  const s = secondsLeft(ts);
  if (s <= 0) return "Ended";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `Ends in ${d} ${plural(d, "day")} ${h} ${plural(h, "hr")}`;
  return `Ends in ${h} ${plural(h, "hr")} ${m} min`;
}

export function ago(ts: bigint | number) {
  const s = Math.max(0, nowSec() - Number(ts));
  if (s < 60) return `${s} sec ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} ${plural(Math.floor(s / 86400), "day")} ago`;
}

export const short = (a?: string) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");

/** Which stock a symbol is, in words people use. */
const NAMES: Record<string, [string, string, string]> = {
  NVDA: ["NVIDIA", "NVIDIA Corporation", "NV"],
  TSLA: ["Tesla", "Tesla, Inc.", "TS"],
  AAPL: ["Apple", "Apple Inc.", "AP"],
  MSFT: ["Microsoft", "Microsoft Corporation", "MS"],
  AMZN: ["Amazon", "Amazon.com, Inc.", "AM"],
  SPY: ["S&P 500", "SPDR S&P 500 ETF", "SP"],
};

export const stockName = (sym: string) => NAMES[sym]?.[0] ?? sym;
export const stockFull = (sym: string) => NAMES[sym]?.[1] ?? sym;
export const stockMono = (sym: string) => NAMES[sym]?.[2] ?? sym.slice(0, 2);

/** Parse what someone typed into a positive number, or 0. */
export function parseAmount(s: string) {
  const v = parseFloat(s);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Keep digits and one dot. */
export function cleanAmount(s: string, dp = 6) {
  const t = s.replace(/[^0-9.]/g, "");
  const [a, ...b] = t.split(".");
  return b.length ? `${a}.${b.join("").slice(0, dp)}` : a;
}

/**
 * A strike as it is written on the split: "210" for $210.00, "212.50" for $212.50. The factory
 * accepts any whole-cent strike, and rounding one to the dollar would label a $212.50 split as $213.
 */
export function lineLabel(strike: number) {
  const cents = Math.round(strike * 100);
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
