import {defineChain} from "viem";

/// Robinhood Chain testnet. An Arbitrum Orbit L2 with ETH as the gas token.
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
  rpcUrls: {default: {http: ["https://rpc.testnet.chain.robinhood.com"]}},
  blockExplorers: {
    default: {name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com"},
  },
  // Multicall3 is at its canonical address here, which is what lets a page read fifteen markets
  // in one round trip instead of fifteen.
  contracts: {
    multicall3: {address: "0xcA11bde05977b3631167028862bE2a173976CA11"},
  },
  testnet: true,
});

export const FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";

export const explorer = (kind: "address" | "tx", id: string) =>
  `${robinhoodTestnet.blockExplorers.default.url}/${kind}/${id}`;

/** Blocks land every ~0.2s here, so a day is roughly 430,000 of them. */
export const BLOCKS_PER_DAY = 430_000n;
