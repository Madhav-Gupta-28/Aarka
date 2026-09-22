export const usd = (v: bigint, dp = 2) =>
  `$${(Number(v) / 1e8).toLocaleString("en-US", {minimumFractionDigits: dp, maximumFractionDigits: dp})}`;

/** Pool prices and USDG balances carry six decimals, not the feed's eight. */
export const cash = (v: bigint, dp = 2) =>
  `$${(Number(v) / 1e6).toLocaleString("en-US", {minimumFractionDigits: dp, maximumFractionDigits: dp})}`;

export const units = (v: bigint, dp = 2) =>
  (Number(v) / 1e18).toLocaleString("en-US", {maximumFractionDigits: dp});

/** Payout ratios are 18-decimal fractions of one underlying token. */
export const pct = (v: bigint) => `${((Number(v) / 1e18) * 100).toFixed(1)}%`;

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function expiryLabel(ts: bigint) {
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleDateString("en-US", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "America/New_York",
  });
}

export function countdown(ts: bigint) {
  const s = Number(ts) - Math.floor(Date.now() / 1000);
  if (s <= 0) return "expired";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

/** How long ago something happened, for feed timestamps and settlement rounds. */
export function timeAgo(ts: bigint) {
  const s = Math.floor(Date.now() / 1000) - Number(ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** A duration in seconds, written the way a countdown reads. */
export function duration(seconds: number) {
  if (seconds <= 0) return "now";
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h < 24 ? `${h}h ${m}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
