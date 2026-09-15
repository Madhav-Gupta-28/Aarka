# Aarka

Split a tokenized stock into a floor and the upside.

Deposit 1 tokenized stock token, get back two tradable ERC-20s:

| Token | Gets at expiry | Shape |
| --- | --- | --- |
| `fNVDA-210-30OCT26` | `min(S, K) / S` of a token | Keeps the downside, capped at the strike |
| `uNVDA-210-30OCT26` | `max(0, S - K) / S` of a token | Zero below the strike, uncapped above |

`f + u = 1` token at every price, always. Return both and redeem your stock token back at any time, before or after expiry.

There is no borrowing anywhere in the design, so there is nothing to liquidate.

Built on Robinhood Chain.

## Contracts

| Contract | Role |
| --- | --- |
| `AarkaFactory` | Creates series. Governs the underlying-to-feed registry, nothing else. |
| `AarkaSeries` | One isolated vault per (underlying, strike, expiry). Holds the deposit, settles, pays claims. |
| `AarkaToken` | The two halves. Minted and burned only by their series. |
| `ExpiryCalendar` | Published, add-only list of valid expiry dates. |
| `AarkaParityHook` | Uniswap v4 hook that keeps the price of the two halves summing to the stock's, and pays the arbitrage to LPs. |
| `AarkaRouter` | Periphery. Keep one half and sell the other in one transaction, or buy a half with cash. Holds nothing. |
| `AarkaLens`, `HookLens` | Read-only batching for the site. Outside the protocol. |

No proxies, no upgrades, no pause on user funds, no privileged withdrawal. Governance cannot move a
token out of any series, and cannot touch a series that already exists.

`redeem()` is never disabled, so anyone holding both halves can always withdraw, oracle or not.
Someone holding one half depends on settlement, and **every series settles**: normally against the
last Chainlink round within 26 hours of expiry — the feeds' daily heartbeat plus margin — and, if
that is still impossible a week after expiry, against the last round before expiry at any age.
The six-hour window this replaced stranded one-half holders on quiet closes; see
[`AUDIT.md`](./AUDIT.md), AUDIT-16.

## Tests

```
forge test --no-match-path test/Fork.t.sol       # 178 tests
forge test --match-path test/Fork.t.sol --fork-url robinhood   # against the live Chainlink feed
forge coverage --no-match-coverage "test|script"
```

Plus 7 fork tests against Robinhood Chain mainnet, including a replay of the real SPY close on
11 September 2026 that the old settlement window could never have settled. Coverage, measured with
`forge coverage --no-match-coverage "test|script|src/testnet"`:

| Contract | Lines | Branches |
| --- | --- | --- |
| `AarkaFactory`, `AarkaToken`, `ExpiryCalendar`, `DateLib` | 100% | 100% |
| `AarkaSeries` | 100% | 100% |
| `AarkaParityHook` | 100% | 73% |
| `AarkaRouter` | 100% | 69% |
| `HookLens` | 100% | 50% |
| `AarkaLens` | 96% | 86% |

The invariant suite runs 512 sequences of 64 random calls each and asserts the vault can always
cover every outstanding claim.

## Deploying

See [`DEPLOY.md`](./DEPLOY.md). Robinhood Chain testnet has no stock tokens and no Chainlink feeds,
so the deploy ships stand-ins for both; Uniswap v4 is already there at its mainnet address.

## Status

Live on Robinhood Chain testnet with twelve open series on NVDA and TSLA, priced by the real
mainnet Chainlink feeds. Reviewed twice; findings and fixes are in [`AUDIT.md`](./AUDIT.md). See
[`ARCHITECTURE.md`](./ARCHITECTURE.md) section 15 for what still stands between this and mainnet.

## Docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the full technical specification.
- [`AUDIT.md`](./AUDIT.md) — both security reviews, every finding and its fix.
- [`TESTING.md`](./TESTING.md) — addresses and a walkthrough on testnet.
- [`DEPLOY.md`](./DEPLOY.md) — deploying, keeping the feeds live, opening series.

## Licence

MIT
