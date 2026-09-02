/**
 * A Black-Scholes reference for the two halves.
 *
 * This is a MODEL, not a price. No contract reads it and the protocol has no opinion on what the
 * halves are worth — mint and redeem enforce only that they sum to one share. Where the split
 * falls is a market view on volatility.
 *
 * It exists because the first person to mint a series is a price-setter with nothing to anchor to,
 * and "no idea at all" is a worse starting point than "a number clearly labelled as a guess".
 */

/** Abramowitz & Stegun 7.1.26 — max error 1.5e-7, plenty for an indicative number. */
function normCdf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

export type Reference = {
  /** Value of one upside token, in the same units as spot. */
  upside: number;
  /** Value of one floor token. Always spot minus the upside, by construction. */
  floor: number;
  /** Share of the underlying's value sitting in the upside leg. */
  upsideShare: number;
  years: number;
};

/**
 * @param spot  current price
 * @param strike strike
 * @param secondsToExpiry seconds remaining
 * @param vol annualised volatility, e.g. 0.40 for 40%
 * @param rate risk-free rate
 */
export function reference(
  spot: number,
  strike: number,
  secondsToExpiry: number,
  vol = 0.4,
  rate = 0.04,
): Reference {
  const T = Math.max(secondsToExpiry, 0) / (365 * 24 * 3600);

  // At or past expiry the model collapses to the actual payoff.
  if (T <= 0 || spot <= 0 || vol <= 0) {
    const upside = Math.max(0, spot - strike);
    return {upside, floor: spot - upside, upsideShare: spot > 0 ? upside / spot : 0, years: 0};
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (rate + (vol * vol) / 2) * T) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;

  // The upside token is a European call. The floor is the rest of the share.
  const call = spot * normCdf(d1) - strike * Math.exp(-rate * T) * normCdf(d2);
  const upside = Math.max(0, Math.min(call, spot));
  return {upside, floor: spot - upside, upsideShare: upside / spot, years: T};
}
