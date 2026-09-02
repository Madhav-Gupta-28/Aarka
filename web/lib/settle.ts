import {publicClient} from "./client";

const AGG_ABI = [
  {type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
   outputs: [{type: "uint80"}, {type: "int256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint80"}]},
  {type: "function", name: "getRoundData", stateMutability: "view",
   inputs: [{name: "id", type: "uint80"}],
   outputs: [{type: "uint80"}, {type: "int256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint80"}]},
] as const;

export type Candidate = {roundId: bigint; price: bigint; updatedAt: bigint};

/**
 * Find the round `settle()` will accept: the last one published at or before expiry.
 *
 * The contract does not read the latest price — the caller names a round and the contract proves
 * it is the right one. So the caller has to find it, which is this. Walking backwards from the
 * latest round is enough: feeds publish in order, and the window we care about is small.
 */
export async function findSettlementRound(
  feed: `0x${string}`,
  expiry: bigint,
  maxLookback = 400,
): Promise<Candidate | null> {
  const [latestId] = (await publicClient.readContract({
    address: feed, abi: AGG_ABI, functionName: "latestRoundData",
  })) as unknown as [bigint, bigint, bigint, bigint, bigint];

  for (let i = 0; i < maxLookback; i++) {
    const id = latestId - BigInt(i);
    let row: readonly [bigint, bigint, bigint, bigint, bigint];
    try {
      row = (await publicClient.readContract({
        address: feed, abi: AGG_ABI, functionName: "getRoundData", args: [id],
      })) as unknown as [bigint, bigint, bigint, bigint, bigint];
    } catch {
      continue; // a phase boundary leaves well-formed ids that do not exist
    }
    const [, price, , updatedAt] = row;
    if (updatedAt === 0n || price <= 0n) continue;
    if (updatedAt <= expiry) return {roundId: id, price, updatedAt};
  }
  return null;
}

/** Mirrors AarkaSeries: 6 hours, so the round comes from the same trading session as the close. */
export const MAX_LOOKBACK_SECONDS = 6n * 60n * 60n;
