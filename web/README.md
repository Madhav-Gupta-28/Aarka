# Aarka — web

Next.js 15 + wagmi + viem, reading Robinhood Chain testnet directly. No backend and no indexer:
series, positions, parity and the hook's own history all come off the chain.

```sh
npm install
npm run dev          # http://localhost:3000
```

Addresses live in `lib/contracts.ts` and point at the deployed testnet set.

## Pages

Each route answers one question, because the people who come here are not the same person:

```
/                    what is this, and what do the two halves cost today
/markets             the option chain — every strike and expiry, grouped by ticker
/markets/[series]    one market: payoff, parity, and everything you can do to it
/portfolio           what you hold, marked at pool prices, and what you can claim
/settle              the settlement queue; anyone can close an expired series
/parity              the hook, live, plus every time it has actually fired
/faucet              test stock, test cash, testnet gas — all self-serve
/docs                how the protocol works, and every contract address
```

## Structure

```
components/DataProvider.tsx  one poller for the whole site; series + parity, shared by context
components/Chain.tsx         the option chain table, banded by expiry
components/Trade.tsx         keep one half, sell the other, in one transaction (AarkaRouter)
components/Split.tsx         deposit a stock for both halves, or recombine them
components/Settle.tsx        settle an expired series; finds the round the contract will accept
components/Claim.tsx         burn a half for its share of the vault once settled
components/ParityDemo.tsx    break parity on purpose and watch the hook close it
components/ParityLedger.tsx  floor + upside against the stock, as the chain reports it
components/PayoffChart.tsx   the two payoffs, drawn. hover reads any price
components/Faucet.tsx        test stock and test USDG, no permission needed
lib/marketData.ts            parity for every market in one multicall; the hook's event log
lib/lens.ts                  paged reads of series and positions
lib/settle.ts                the contract's settlement rules, applied before you send
lib/contracts.ts             addresses + the minimal ABIs actually used
```

## Two things worth knowing

**Reads are batched.** Fifteen markets would be fifteen `parity` calls. Multicall3 is at its
canonical address on this chain, so `readParity` sends one. `DataProvider` then holds the result for
every page, which is why moving between them shows data instead of an empty frame.

**The parity log reads retired hooks too.** Replacing a hook replaces the market, not the series, so
`LEGACY_MARKETS` keeps the superseded addresses and the history survives a redeployment. What the
mechanism has done is a fact about the protocol, not about whichever hooks are current.

Every write passes the Robinhood Chain testnet chain id, so a wallet on another network cannot sign
it (AUDIT-18).
