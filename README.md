# Aarka

Split a tokenized stock into a floor and the upside.

Deposit 1 tokenized stock token, get back two tradable ERC-20s:

| Token | Gets at expiry | Shape |
| --- | --- | --- |
| `fNVDA-26SEP` | `min(S, K) / S` of a token | Keeps the downside, capped at the strike |
| `uNVDA-26SEP` | `max(0, S - K) / S` of a token | Zero below the strike, uncapped above |

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

No proxies, no upgrades, no pause on user funds, no privileged withdrawal. Governance cannot move a
token out of any series, and cannot touch a series that already exists.

`redeem()` is never disabled, so if the oracle dies permanently nothing is stranded: hold both
halves and withdraw.

## Tests

```
forge test                                        # 82 tests
forge test --match-path test/Fork.t.sol --fork-url robinhood   # against the live Chainlink feed
forge coverage --no-match-coverage "test|script"
```

100% line and function coverage on `src/`. The invariant suite runs 512 sequences of 64 random
calls each and asserts the vault can always cover every outstanding claim.

## Deploying

See [`DEPLOY.md`](./DEPLOY.md). Robinhood Chain testnet has no stock tokens and no Chainlink feeds,
so the deploy ships stand-ins for both; Uniswap v4 is already there at its mainnet address.

## Status

Core protocol complete and tested. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) section 15 for the
items that must be resolved before mainnet.

## Docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the full technical specification.

## Licence

MIT
