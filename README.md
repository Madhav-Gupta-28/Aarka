<div align="center">

# 🌗 Aarka

### Split a tokenized stock into a Floor and the Upside.

**One share in, two tokens out.** The Floor keeps the share's value up to a price line. The Upside
gets everything above it. Keep one and sell the other: earn cash on shares you hold, or bet on a
rise for a fraction of a share. No borrowing, so nothing can ever be liquidated. Built on
**Robinhood Chain**, priced by **Chainlink**, traded on **Uniswap v4**.

![tests](https://img.shields.io/badge/tests-213%20unit%20%2B%2092%20mainnet%20fork-2ea44f)
![coverage](https://img.shields.io/badge/mainnet%20fork%20coverage-100%25%20lines%2C%2099%25%20branches-2ea44f)
![verified](https://img.shields.io/badge/contracts-71%20verified-1D4ED8)
![audits](https://img.shields.io/badge/reviews-5%20rounds%2C%2032%20findings-8C6A3F)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

🌐 **[Live app](https://aarka-app.vercel.app)** · 🧭 **[How it works](https://aarka-app.vercel.app/how)** · 🛡 **[Audit](AUDIT.md)** · 📄 **[Architecture](ARCHITECTURE.md)**

> **Buildathon judging.** The Arbitrum Open House Singapore submission is commit
> [`015c423`](https://github.com/Madhav-Gupta-28/Aarka/tree/buildathon-submission) (tag
> `buildathon-submission`, 4 Oct 2026), and the live app still runs exactly the contracts that
> submission lists. Everything from 8 Oct onward (the mainnet fork suite, AUDIT-30 to AUDIT-32 and
> their fixes, a set of post-buildathon testnet markets) came after the submission, is not used by
> the app, and is not part of what was submitted.

**[11 series settled](#proven-on-testnet)** against Chainlink closes · **4** parity restorations, **$3,655** paid to LPs · **0** liquidations possible

</div>

---

## The problem

A tokenized stock is a share you can only hold or sell. The two things stock holders actually do
with options, **sell the growth they don't expect** (a covered call) or **buy the growth they do
expect** (a call), need an option writer on the other side, margin, and on-chain, a weekly auction
into a handful of market makers. Aarka needs none of it.

## What Aarka is

A vault that splits one share into two ERC-20s at a fixed **line** (the strike) and **end date**:

| Token | Pays at the end, per token | Behaves like |
| --- | --- | --- |
| **Floor** `fNVDA-210-30OCT26` | `min(P, K) / P` of a share | The share, capped at the line |
| **Upside** `uNVDA-210-30OCT26` | `max(P − K, 0) / P` of a share | A call on the share above the line |

- **Floor + Upside = 1 share at every price.** So the vault is always exactly solvent, with no option writer and no counterparty.
- **Always reversible.** One of each always turns back into one share: before the end date, after it, or with a dead oracle.
- **Every split settles.** Against a specific Chainlink round, with a one-hour challenge and a late path, so nobody is ever stranded.
- **The AMM is the market.** Each half trades against USDG on Uniswap v4, and a hook keeps `P(Floor) + P(Upside) = P(share)`.

## User flow

```mermaid
flowchart LR
    S([1 NVDA share]) -->|split| V[(Series vault<br/>holds the share)]
    V --> F[Floor]
    V --> U[Upside]
    F --> E1{{Earn cash<br/>keep Floor, sell Upside}}
    U --> E1
    C([USDG cash]) -->|buy| U2{{Bet on a rise<br/>buy the Upside}}
    F & U -->|put back together| S
    E1 & U2 --> X[End date, 4pm ET]
    X -->|settle roundId<br/>Chainlink close| Z[Final price carved<br/>1-hour challenge]
    Z -->|claim| P([Paid in the stock itself])
```

Split, rejoin, buy, sell, and *keep one, sell the other* in a single transaction are all in the
[app](https://aarka-app.vercel.app/app), with free practice shares and cash on testnet.

## Architecture

```mermaid
flowchart TB
    subgraph Core["Core · immutable, no admin over funds"]
        FAC[AarkaFactory<br/>feed registry · creates series]
        CAL[ExpiryCalendar<br/>NYSE closes, add-only]
        SER[AarkaSeries<br/>one per stock × line × date<br/>mint · redeem · settle · claim]
        TOK[AarkaToken × 2<br/>Floor · Upside]
        FAC -->|CREATE2| SER
        CAL -.valid dates.-> FAC
        SER -->|mint / burn| TOK
    end
    subgraph Oracle["Prices"]
        CL[Chainlink equity feed<br/>8 decimals, rounds]
        SEQ[Sequencer uptime feed]
    end
    subgraph Market["Uniswap v4"]
        PM[PoolManager]
        P1[Stock / USDG]
        P2[Floor / USDG]
        P3[Upside / USDG]
        HK[AarkaParityHook<br/>afterSwap]
        PM --- P1 & P2 & P3
        P2 & P3 -.afterSwap.-> HK
        HK -->|mint or redeem 1:1| SER
        HK -->|donate profit| PM
    end
    RT[AarkaRouter<br/>split and sell in one call] --> SER
    RT --> PM
    CL -->|settle roundId| SER
    SEQ -.grace period.-> SER
    LENS[AarkaLens · HookLens<br/>read-only] --> WEB[Next.js app]
    SER -.-> LENS
    PM -.-> LENS
```

Everything outside **Core** is replaceable without touching a series: the router, the hooks and
the lenses have all been redeployed on testnet while the same series kept running.

## How it works

**Payoff.** `floor = mulDiv(min(P, K), 1e18, P)` rounded down, and `upside = 1e18 − floor`
computed as the exact complement, so the two always sum to one share by construction. Claims burn
first and round down, leaving dust in the vault. Mint counts the vault's balance delta, so it stays
exact even for a fee-on-transfer token.

**Settlement.** `settle(roundId)` names a Chainlink round and the contract proves it is the right one:
`updatedAt ≤ expiry`, no more than 26 hours old (the feed's 24-hour heartbeat plus margin), and round
`id + 1` either doesn't exist (a phase boundary, caught) or is after expiry. The normal path also
requires the L2 sequencer to have been up for an hour, the stock not to be oracle-paused, and no
ERC-8056 corporate action after the round. For one hour a strictly later qualifying round can replace
the price, then claims open. If the normal path stays impossible for 7 days, the last round before
expiry is accepted at any age, so **every series resolves**.

**Parity hook.** On every swap in a hooked pool, `afterSwap` compares `P(Floor) + P(Upside)` with
the share pool. Past 100 bps (above the ~90 bps that three pool fees cost) it binary-searches, in 20
steps, for the size where the two meet. That is also the profit-maximising size. The size is capped
by `maxArbSize`, half the virtual reserve and the PoolManager's real balance. It then trades inside the
same unlock with flash accounting: halves dear, so buy the share, split it and sell both; halves
cheap, so buy both, rejoin and sell the share. The arb runs in a self-call wrapped in try/catch and
must end with positive profit and every currency delta flat, so a failed arb never touches the
user's swap. Profit is donated to the in-range LPs, and new liquidity must stay for an hour, so it
can't be sniped just in time.

**Governance.** Anyone can create a series for any whole-cent line within 5× of spot and any date on
the published calendar. The one governed input is which Chainlink feed prices each stock, and changing
it reaches only series created afterwards. No proxies, no upgrades, no pause on user funds, no price
override.

## Proven on testnet

All on Robinhood Chain testnet, against stock and USDG stand-ins and feeds that copy the real
mainnet Chainlink prices with their original timestamps.

**Settled against the Chainlink close**, by anyone calling `settle`:

| Split | Close | Floor / Upside per token |
| --- | --- | --- |
| NVDA $215 · 4 Sep | $230.24 | 93.38% / 6.62% |
| NVDA $215 · 11 Sep | $219.48 | 97.96% / 2.04% |
| NVDA $240 · 11 Sep | $219.48 | 100% / 0% |
| NVDA $210 · 25 Sep | $225.66 | 93.06% / 6.94% |
| NVDA $230 · 25 Sep | $225.66 | 100% / 0% |
| TSLA $350 · 25 Sep | $371.75 | 94.15% / 5.85% |
| TSLA $400 · 25 Sep | $371.75 | 100% / 0% |
| NVDA $210 · 2 Oct | $235.00 | 89.36% / 10.64% |
| NVDA $230 · 2 Oct | $235.00 | 97.87% / 2.13% |
| TSLA $350 · 2 Oct | $370.45 | 94.48% / 5.52% |
| TSLA $400 · 2 Oct | $370.45 | 100% / 0% |

**The parity hook, live.** A $50,000 Floor buy on NVDA $210 · 30 Oct: in the same transaction the
hook bought and split 215.21 shares, sold both halves, closed the gap back to 1 bps and paid
**$1,246.33** to LPs.
[`0xaf2a55d1…`](https://explorer.testnet.chain.robinhood.com/tx/0xaf2a55d1ad02fe7e6fd9139337ffdd792c6f0f0a8dc65c88b093bab4d4b23101)
Across every hook so far: 4 restorations, 680.96 halves, $3,655.56 to LPs.

**Every user action, end to end:**

| Action | Transaction |
| --- | --- |
| Split 1 NVDA into Floor + Upside | [`0x1b63919c…`](https://explorer.testnet.chain.robinhood.com/tx/0x1b63919cc3f4e340ca67d21d6e7f78b626d8b778141eebe55c9711a27365078d) |
| Put a pair back together | [`0x84dac2dd…`](https://explorer.testnet.chain.robinhood.com/tx/0x84dac2ddb8382739c8086a6c3535d00f74df59edd0de933666705e4cc7ccdb2f) |
| Keep the Floor, sell the Upside, one call | [`0xce052e40…`](https://explorer.testnet.chain.robinhood.com/tx/0xce052e40136c1866ff765f210c80b1fea4b9dc2732b970bd5ca65a8ca2aa212c) |
| Buy a Floor with cash, then sell it | [`0x1aa92d98…`](https://explorer.testnet.chain.robinhood.com/tx/0x1aa92d98fb614d67a1789d3a60cd7b47a0279530027209f4d79dcc97eedf9636) · [`0xf43d3d97…`](https://explorer.testnet.chain.robinhood.com/tx/0xf43d3d97b831f6b6b816939c691032ee3299c062337a7d85d53d8b58fead3476) |
| Settle NVDA $210 · 25 Sep at $225.66 | [`0x59239983…`](https://explorer.testnet.chain.robinhood.com/tx/0x592399839b33e9e821ddaa330a8816b77331eb56c5ff2534d95afc41cbb7a58d) |
| Collect: 2 Floors + 2 Upsides → exactly 2.0000 NVDA | [`0x9d9d267e…`](https://explorer.testnet.chain.robinhood.com/tx/0x9d9d267eb73437086d86f41e2e02f56887e8732ead819972ceabbb143a6b5424) · [`0xef842d37…`](https://explorer.testnet.chain.robinhood.com/tx/0xef842d378a7828455b2cb9d9f98b7895edcb3aabd518a387e51ae39dd773e171) |
| Collect below the line: Upside burns for $0 | [`0x46658ddd…`](https://explorer.testnet.chain.robinhood.com/tx/0x46658ddd26265cb0bba2ef686e196655cb394a1ad11e97257c91ff65c19110cc) |

Every address is in [`TESTING.md`](TESTING.md), and all 71 contracts are verified on the
[explorer](https://explorer.testnet.chain.robinhood.com/address/0x69caa2b3d4f732861A36e78b5A3992d18faA9BcA).

## Security

- **Five review rounds, 32 findings:** every one fixed except two documented ones, an informational note and the issuer's powers below, each fix with a test that reproduces the attack. [`AUDIT.md`](AUDIT.md) has them all, including one live bug found by using the app, one found only on a fork of real mainnet, and the review leads left open with the reason.
- **Invariants:** payouts sum to one share; the vault always covers every claim; no value is created; terms never change. Checked over 2.25 million random calls.
- **No admin over funds:** nobody can move a token out of a series, change its terms, pause redemption or set a price.
- **Fails safe:** an oracle outage delays settlement, never strands it; a failed arb never reverts the trader's swap.

### What Aarka cannot protect you from: the stock token's issuer

Aarka holds the real stock token, and the token is a regulated security whose issuer keeps
compliance powers over it. Every Robinhood stock token sits behind one upgradeable contract whose
role holders can, on mainnet today:

| Power | What it does to a series | Tested against the real role holder |
| --- | --- | --- |
| `adminBurn` | burns stock out of the vault itself; pairs are then backed by less than a share, and whoever exits last cannot | yes |
| `blockAccounts` | blocks the vault: no deposit, no redemption, no claim | yes |
| `pause` | stops every transfer: settlement still runs, every exit waits | yes |
| `pauseOracle`, `updateMultiplier` | a pause or corporate action; Aarka waits for it, and settles late after a week if it must | yes |
| upgrade | replaces the token's code | not exercised |

A blocked holder can still name another address for any exit. Aarka cannot remove these powers; it
can only say plainly that holding a half means trusting the issuer exactly as holding the stock does.

## Testing

```bash
forge test --no-match-path "test/{Fork.t.sol,XLayerFork.t.sol,fork/**}"   # 213 unit, fuzz and invariant tests
forge test --match-path "test/fork/mainnet/*" -j 2                         # 92 on a fork of Robinhood Chain mainnet
forge test --match-path test/Fork.t.sol --fork-url robinhood              # 7 against mainnet's latest block
```

**On real mainnet.** [`test/fork/mainnet`](test/fork/mainnet) runs the whole protocol against the
live NVDA, TSLA and USDG tokens, Chainlink's feeds, the Uniswap v4 PoolManager and the existing
NVDA/USDG and TSLA/USDG pools. Series are created through the factory on 28 September 2026, traded
through the router and hooked pools, then settled on 8 October against the rounds Chainlink actually
published for the 2 October close (NVDA $234.997, TSLA $370.448), and every holder collects. The
issuer's real role holders pause the oracle, schedule a corporate action, burn and block, and a
Chainlink aggregator migration is replayed on the live NVDA proxy. It needs archive state, which the
public RPC does not keep; `robinhood_archive` in `foundry.toml` points at a public archive endpoint.

Coverage from that suite alone, on every contract deployed to Robinhood Chain:

| Contract | Lines | Branches |
| --- | --- | --- |
| `AarkaSeries`, `AarkaFactory`, `AarkaToken`, `ExpiryCalendar`, `DateLib`, `AarkaRouter`, `AarkaLens`, `HookLens`, `AarkaSequencerFeed` | 100% | 100% |
| `AarkaParityHook` | 100% | 32 of 33 |

The one branch it does not reach is the sign check in `_settleDebt`, which runs only straight after
an exact-input swap through a pool with liquidity, and such a swap always leaves a debt.

The parity hook, measured against the live 0.30% NVDA/USDG pool, with about 9,000 of each half in its own pools:

| Floor buy | $10k | $50k | $100k | $250k | $500k | $1m |
| --- | --- | --- | --- | --- | --- | --- |
| NVDA split by the hook | under threshold | 164 | 322 | 754 | 1,363 | 1,140 |
| Paid to LPs | — | $676 | $3,141 | $19,982 | $67,149 | $210,261 |
| Gap left | 96 bps | 0 | 3 bps | 156 bps | 2,993 bps | 3,558 bps |

Before AUDIT-30 the $1m trade drew no correction at all. Unit-suite coverage
(`forge coverage --no-match-coverage "test|script|src/testnet"`) is 99% of lines and 93% of
branches; the older fork suites replay the real SPY close of 11 September 2026 and a
198,652-token sale that once silenced the hook.

## Tech stack

- **Contracts:** Solidity ^0.8.26 (deployed with 0.8.33), Foundry, OpenZeppelin, Uniswap v4 core
- **Chain:** Robinhood Chain (Arbitrum Orbit), Chainlink equity feeds, ERC-8056 stock tokens
- **App:** Next.js 15, wagmi, viem, React Query, Motion. No backend or indexer: everything is read from the chain through `AarkaLens` and `HookLens`
- **Ops:** a keeper that mirrors the mainnet feeds and reports sequencer uptime ([`keeper/Dockerfile`](keeper/Dockerfile))

## Quick start

```bash
git clone --recursive https://github.com/Madhav-Gupta-28/Aarka && cd Aarka
forge build && forge test --no-match-path "test/{Fork.t.sol,XLayerFork.t.sol,fork/**}"

cd web && npm install && npm run dev        # http://localhost:3000, against the live testnet
```

The app runs against the deployed testnet contracts with no configuration. To deploy your own set,
open series and run the feed keeper, follow [`DEPLOY.md`](DEPLOY.md).

## Repository layout

```
src/                 AarkaSeries · AarkaFactory · AarkaToken · ExpiryCalendar · AarkaLens · HookLens
  hook/              AarkaParityHook, the Uniswap v4 parity hook
  periphery/         AarkaRouter, split-and-sell in one call
  adapters/          AarkaSequencerFeed · StreamsAggregator (Chainlink Data Streams, for X Layer)
  testnet/           stand-in stock, USDG and feeds; the NYSE calendar
test/                unit, fuzz, invariant, audit reproductions and fork suites
script/              deploy, open markets, mirror feeds, settle, verify
web/                 the app
keeper/              the feed and sequencer keeper, as a container
```

## Docs

- [`ARCHITECTURE.md`](ARCHITECTURE.md): the full specification, with every design decision and its alternative
- [`AUDIT.md`](AUDIT.md): four review rounds, every finding and its fix
- [`TESTING.md`](TESTING.md): every address, and a walkthrough on testnet
- [`DEPLOY.md`](DEPLOY.md): deploying, opening markets, keeping the feeds live

## Licence

[MIT](LICENSE).
