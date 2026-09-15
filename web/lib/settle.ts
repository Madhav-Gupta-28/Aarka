import {publicClient} from "./client";

const AGG_ABI = [
  {type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
   outputs: [{type: "uint80"}, {type: "int256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint80"}]},
  {type: "function", name: "getRoundData", stateMutability: "view",
   inputs: [{name: "id", type: "uint80"}],
   outputs: [{type: "uint80"}, {type: "int256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint80"}]},
] as const;

export type Candidate = {roundId: bigint; price: bigint; updatedAt: bigint};

/** Mirrors AarkaSeries.MAX_SETTLEMENT_AGE: the feeds' 24-hour heartbeat plus two hours. */
export const MAX_LOOKBACK_SECONDS = 26n * 60n * 60n;

/** Mirrors AarkaSeries.LATE_SETTLEMENT_DELAY: after this, any age is accepted. */
export const LATE_SETTLEMENT_DELAY = 7n * 24n * 60n * 60n;

type Row = {price: bigint; updatedAt: bigint};

async function readRound(feed: `0x${string}`, id: bigint): Promise<Row | null> {
  try {
    const [, price, , updatedAt] = (await publicClient.readContract({
      address: feed, abi: AGG_ABI, functionName: "getRoundData", args: [id],
    })) as unknown as [bigint, bigint, bigint, bigint, bigint];
    if (updatedAt === 0n || price <= 0n) return null;
    return {price, updatedAt};
  } catch {
    return null; // a phase boundary leaves well-formed ids that do not exist
  }
}

/**
 * Find the round `settle()` will accept, applying the same three rules the contract does:
 *
 *   1. published at or before expiry
 *   2. no more than 26 hours before expiry, unless the series is a week past expiry
 *   3. the next round id is either missing or published after expiry
 *
 * An earlier version returned the first round at or before expiry while walking back from the
 * latest. That assumes rounds are published in time order. Real feeds are, but a round published
 * out of order made it pick a round the contract rejects, so every rule is now checked here
 * rather than inferred from the walk.
 */
export async function findSettlementRound(
  feed: `0x${string}`,
  expiry: bigint,
  maxLookback = 400,
): Promise<Candidate | null> {
  const [latestId] = (await publicClient.readContract({
    address: feed, abi: AGG_ABI, functionName: "latestRoundData",
  })) as unknown as [bigint, bigint, bigint, bigint, bigint];

  const rows = new Map<bigint, Row | null>();
  const get = async (id: bigint) => {
    if (!rows.has(id)) rows.set(id, await readRound(feed, id));
    return rows.get(id)!;
  };

  let best: Candidate | null = null;
  let misses = 0;
  for (let i = 0; i < maxLookback; i++) {
    const id = latestId - BigInt(i);
    if (id < 0n) break;
    const row = await get(id);
    if (!row) {
      if (++misses > 32) break; // past the start of this phase's history
      continue;
    }
    misses = 0;

    if (row.updatedAt > expiry) continue;
    const late = BigInt(Math.floor(Date.now() / 1000)) >= expiry + LATE_SETTLEMENT_DELAY;
    if (!late && expiry - row.updatedAt > MAX_LOOKBACK_SECONDS) {
      // With rounds in time order everything further back is older still. Once a valid round
      // has been found there is nothing left to improve on.
      if (best) break;
      continue;
    }

    const next = await get(id + 1n);
    if (next && next.updatedAt <= expiry) continue; // the contract would say LaterRoundExists

    if (!best || row.updatedAt > best.updatedAt) best = {roundId: id, ...row};
  }
  return best;
}
