export const usd = (v: bigint, dp = 2) =>
  `$${(Number(v) / 1e8).toLocaleString("en-US", {minimumFractionDigits: dp, maximumFractionDigits: dp})}`;

export const units = (v: bigint, dp = 2) =>
  (Number(v) / 1e18).toLocaleString("en-US", {maximumFractionDigits: dp});

/** Payout ratios are 18-decimal fractions of one underlying token. */
export const pct = (v: bigint) => `${((Number(v) / 1e18) * 100).toFixed(1)}%`;

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
