/**
 * The words that carry the mechanics. Each one has a one-line meaning, a tiny looping picture,
 * and a chamber to open for the full deep dive.
 */

export type Chamber = "coin" | "sun" | "scales" | "timeline";
export type TermKey = "floor" | "upside" | "line" | "end" | "final" | "sun" | "scales" | "rejoin" | "collect" | "window";

export const TERMS: Record<TermKey, {name: string; def: string; chamber: Chamber; loop: string}> = {
  floor: {name: "Floor", def: "The bottom half of a split share. Pays the stock's price, up to the line.", chamber: "coin", loop: "floor"},
  upside: {name: "Upside", def: "The top half. Pays every dollar the stock ends above the line, and can end at $0.", chamber: "coin", loop: "upside"},
  line: {name: "The line", def: "The price where a share is cut in two. Fixed for the life of the split.", chamber: "coin", loop: "line"},
  end: {name: "End date", def: "The moment the final price is taken, like 4:00 pm New York time on Oct 30. It never moves.", chamber: "timeline", loop: "end"},
  final: {name: "Final price", def: "The last price The Sun published at or before the end time. It decides what each half pays.", chamber: "sun", loop: "final"},
  sun: {name: "The Sun", def: "Our independent price source: Chainlink's public price feeds. Nobody at Aarka can set a price.", chamber: "sun", loop: "sun"},
  scales: {name: "The Scales", def: "A Uniswap v4 hook that keeps Floor + Upside priced at one share, by trading the gap away.", chamber: "scales", loop: "scales"},
  rejoin: {name: "Put back together", def: "One Floor plus one Upside from the same split become one share again. Any time, even after the end.", chamber: "coin", loop: "rejoin"},
  collect: {name: "Collect", def: "After the end, take what your halves paid, in the stock itself. No deadline.", chamber: "timeline", loop: "collect"},
  window: {name: "The one-hour window", def: "After the price is carved, anyone may replace it with a later round the rules allow, for one hour.", chamber: "timeline", loop: "window"},
};

export const CHAMBERS: Record<Chamber, {title: string; kicker: string}> = {
  coin: {title: "The coin, cut at the line", kicker: "FLOOR · UPSIDE · PUT BACK TOGETHER"},
  sun: {title: "How The Sun chooses the final price", kicker: "THE SUN · FINAL PRICE"},
  scales: {title: "How The Scales keep it honest", kicker: "THE SCALES · UNISWAP V4 HOOK"},
  timeline: {title: "From the end time to your payout", kicker: "END DATE · ONE-HOUR WINDOW · COLLECT"},
};
