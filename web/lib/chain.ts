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
  testnet: true,
});

export const FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";
