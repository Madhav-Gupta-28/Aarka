# Aarka — web

Next.js 15 + wagmi + viem, reading Robinhood Chain testnet directly. No backend and no indexer:
series and positions come from `AarkaLens`, a page at a time.

```sh
npm install
npm run dev          # http://localhost:3000
```

Addresses live in `lib/contracts.ts` and point at the deployed testnet set.

## Structure

```
components/Trade.tsx         keep one half, sell the other, in one transaction (AarkaRouter)
components/Split.tsx         deposit a stock for both halves, or recombine them
components/Settle.tsx        settle an expired series; finds the round the contract will accept
components/Claim.tsx         burn a half for its share of the vault once settled
components/ParityPanel.tsx   the three pools the hook keeps honest, and a trade that tests it
components/PayoffChart.tsx   the two payoffs, drawn. hover reads any price
components/Faucet.tsx        test stock and test USDG, no permission needed
lib/lens.ts                  paged reads of series and positions
lib/settle.ts                the contract's settlement rules, applied before you send
lib/contracts.ts             addresses + the minimal ABIs actually used
```

Every write passes the Robinhood Chain testnet chain id, so a wallet on another network cannot sign it.
