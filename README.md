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

## Status

In development.

## Docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the full technical specification.

## Licence

MIT
