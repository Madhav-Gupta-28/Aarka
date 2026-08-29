# Aarka — Technical Architecture

**Version 1.0 · Robinhood Chain**

This document is the complete specification for Aarka. Anyone who reads it should be able to rebuild the protocol from scratch without consulting the authors.

Every on-chain fact in here was verified directly against a live RPC or a primary source document. Facts I could not verify are listed in [§15](#15-open-items) and are marked in the text as **UNVERIFIED**. Nothing in this document is assumed.

---

## Table of contents

1. [The primitive](#1-the-primitive)
2. [The payoff, proven](#2-the-payoff-proven)
3. [Verified chain facts](#3-verified-chain-facts)
4. [Why corporate actions do not require strike adjustment](#4-why-corporate-actions-do-not-require-strike-adjustment)
5. [Contract architecture](#5-contract-architecture)
6. [Integer arithmetic and rounding](#6-integer-arithmetic-and-rounding)
7. [The oracle layer](#7-the-oracle-layer)
8. [Settlement](#8-settlement)
9. [Governance and its limits](#9-governance-and-its-limits)
10. [User flows](#10-user-flows)
11. [Module 2 — the Uniswap v4 parity hook](#11-module-2--the-uniswap-v4-parity-hook)
12. [Threat model](#12-threat-model)
13. [Invariants](#13-invariants)
14. [Test plan](#14-test-plan)
15. [Open items](#15-open-items)
16. [Sources](#16-sources)

---

## 1. The primitive

Aarka splits a tokenized stock into two claims on the same share.

```
MINT     deposit 1 NVDA        ->  1 fNVDA + 1 uNVDA
REDEEM   return 1 of each      ->  1 NVDA          (always, before or after expiry)
SETTLE   at expiry, price S, strike K
           fNVDA               ->  min(S, K) / S   of one token
           uNVDA               ->  max(0, S - K) / S of one token
```

`fNVDA` is the **floor**. It keeps all of the downside and gives up everything above the strike. In USD terms it is worth `min(S, K)` — a bond plus a short put.

`uNVDA` is the **upside**. It is worth zero at or below the strike and uncapped above it. In USD terms it is worth `max(0, S - K)` — a call option.

The two together are always exactly one share.

### What is actually new here

Splitting a payoff into senior and junior claims is old. Tranching goes back to the 1980s in structured credit, and on-chain it has been done for yield (BarnBridge SMART Alpha, Tranchess, Pendle). Aarka is not claiming the idea of tranching.

Three things are specific to this design:

1. **There is no debt.** Prior on-chain leverage products create a borrower and a lender, which means a solvency condition, which means liquidation. Aarka's two tokens sum to exactly the deposit at every possible price, so there is no solvency condition to violate. Liquidation is not mitigated, it is structurally absent.

2. **There is no auction.** Every on-chain options protocol that died — Ribbon, Lyra, Dopex — sold inventory through a scheduled auction into a handful of market makers, with no secondary market to escape to. Aarka has no auction, no schedule, and no market maker. The AMM *is* the secondary market. See [§12.7](#127-the-friday-problem).

3. **Bootstrap is single-sided.** A holder mints both halves and sells only the one they do not want. There is no counterparty to find, no order to match, and no capital required beyond the share they already own.

### What this is not

It is not leverage. It is not a loan. Neither token can be liquidated, margin-called, or forced to close. The worst case for a floor holder is that the stock goes to zero, which is the same worst case they had before splitting.

---

## 2. The payoff, proven

Let `S` be the settlement price of one token in USD and `K` the strike, both strictly positive. Define the payout of each token in **units of the underlying token**:

```
f(S) = min(S, K) / S
u(S) = max(0, S - K) / S
```

### Conservation

**Claim.** `f(S) + u(S) = 1` for all `S > 0`.

*Case S <= K.* `min(S,K) = S` and `max(0, S-K) = 0`, so `f + u = S/S + 0 = 1`.

*Case S > K.* `min(S,K) = K` and `max(0, S-K) = S-K`, so `f + u = K/S + (S-K)/S = (K + S - K)/S = S/S = 1`.

Both cases give exactly 1. There is no price at which the two claims sum to more or less than the deposit. **This is the property the whole design rests on**, and it is why `redeem()` never has to be switched off — see [§5.4](#54-redeem-is-permanent).

### Monotonicity and bounds

`f(S) = min(S,K)/S = min(1, K/S)`, so `f` is bounded in `(0, 1]` and non-increasing in `S`.
`u(S) = 1 - f(S)`, so `u` is bounded in `[0, 1)` and non-decreasing in `S`.

Neither can be negative. Neither can exceed one token. A holder of either token can never owe anything.

### The USD payoff

Multiplying by `S` gives the value in dollars:

```
floor  holder receives  min(S, K)      USD  ->  capped at K, keeps all downside
upside holder receives  max(0, S - K)  USD  ->  a European call struck at K
```

The floor token is therefore economically a covered call, and the upside token a call option, but neither is written as an option contract. There is no premium, no writer, and no margin. The payoff arises purely from how the deposit is divided at settlement.

### Why payouts are denominated in the underlying, not USDG

The vault holds the stock token. Paying out in the stock token means:

- settlement needs no swap, no router, and no USDG liquidity;
- settlement cannot fail because a DEX is thin or a price moved mid-transaction;
- the protocol never holds or routes a second asset.

A holder who wants dollars sells the token afterwards. That is their choice, made at a price they can see, rather than a swap the protocol forces on them at settlement.

---

## 3. Verified chain facts

Every value in this section was read directly from a live node or a primary document on 2026-08-29. Reproduce any of them with the commands given.

### 3.1 Network

| | Mainnet | Testnet |
| --- | --- | --- |
| Chain ID | `4663` | `46630` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Faucet | — | `https://faucet.testnet.chain.robinhood.com` |

```sh
cast chain-id --rpc-url https://rpc.mainnet.chain.robinhood.com   # -> 4663
cast chain-id --rpc-url https://rpc.testnet.chain.robinhood.com   # -> 46630
```

Robinhood Chain is an **Arbitrum Orbit L2** settling to Ethereum, using Ethereum blobs for data availability, with **ETH as the native gas token**. Mainnet launched 1 July 2026.

The Orbit fact has a direct engineering consequence: an L2 sequencer can go down, and while it is down a Chainlink feed stops updating but still returns a stale answer without reverting. Aarka must check the sequencer uptime feed before trusting any price. See [§7.3](#73-sequencer-uptime).

### 3.2 Core token contracts (mainnet)

| Token | Address | Decimals |
| --- | --- | --- |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | **6** |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | 18 |

```sh
cast call 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 "decimals()(uint8)" \
  --rpc-url https://rpc.mainnet.chain.robinhood.com   # -> 6
```

**Three different decimal bases are in play and mixing them is the most likely source of a catastrophic bug in this codebase:**

```
stock tokens   18 decimals
Chainlink feed  8 decimals
USDG            6 decimals
```

Aarka's core contracts touch only the first two. USDG appears solely in Module 2 (the AMM hook) and in the front end. Every conversion is written out explicitly in [§6](#6-integer-arithmetic-and-rounding).

### 3.3 Stock tokens

Each stock token is a **standard ERC-20 with 18 decimals**. It implements ERC-8056 (Scaled UI Amount Extension) for corporate actions. There is **no on-chain asset registry** to enumerate them from; the canonical list is published on the Robinhood Chain contracts page and must be pinned at deploy time.

Direct mint and burn of stock tokens is restricted to Authorized Participants with KYB onboarding. Everyone else — including Aarka — acquires them on the secondary market. Aarka never mints or burns a stock token; it only holds and returns them.

### 3.4 Uniswap v4

| Contract | Address | Chains |
| --- | --- | --- |
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | 4663 **and** 46630 |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | 4663 |
| UniversalRouter | `0x8876789976decbfcbbbe364623c63652db8c0904` | 4663 |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | 4663 |
| Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | 4663 |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 4663 **and** 46630 |

```sh
# PoolManager exists on BOTH networks, at the same address:
cast code 0x8366a39cc670b4001a1121b8f6a443a643e40951 --rpc-url https://rpc.mainnet.chain.robinhood.com | wc -c  # 48021
cast code 0x8366a39cc670b4001a1121b8f6a443a643e40951 --rpc-url https://rpc.testnet.chain.robinhood.com | wc -c  # 48021
```

This matters: Module 2 can be developed and demonstrated end-to-end on testnet without deploying a PoolManager, and the mainnet address is identical, so no address-swapping between environments.

USDG at the mainnet address has **no code on testnet**. Testnet token addresses differ from mainnet and must be resolved separately — see [§15](#15-open-items).

### 3.5 Chainlink feeds

Robinhood tokenized equity feeds use the standard `AggregatorV3Interface`. Confirmed properties:

- **8 decimals.**
- The answer is the **token price**, defined by Chainlink as `Token Price = Underlying Equity Market Price x Multiplier`.
- Deployed on **Robinhood Chain mainnet only**.
- They are **24/5** feeds and **have no heartbeat during off-hours**. When US equity markets are closed the feed holds its last published price while `latestRoundData()` continues to return successfully.
- During a corporate action the token contract exposes `oraclePaused()`; while true, "the feed stops publishing new prices and holds the last known good value."

The single most important consequence, quoted directly from the Robinhood integration guide:

> "The Chainlink price already includes the corporate-action multiplier … so the value you read is the token's full price — **don't apply the multiplier yourself**."

Aarka therefore never calls `uiMultiplier()` for pricing. It reads the multiplier only as a *safety signal*, never as a *price input*. See [§4](#4-why-corporate-actions-do-not-require-strike-adjustment) and [§7.4](#74-corporate-action-guard).

### 3.6 ERC-8056

The standard the stock tokens implement for corporate actions:

```solidity
interface IScaledUIAmount {
    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);
    event TransferWithUIAmount(address indexed from, address indexed to, uint256 amount, uint256 uiAmount);
    function uiMultiplier() external view returns (uint256);
}

// Required extension — a corporate action is announced BEFORE it takes effect.
interface IScaledUIAmountNewUIMultiplier {
    function newUIMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
}
```

ERC-165 interface IDs: `IScaledUIAmount` = `0xa60bf13d`, `IScaledUIAmountNewUIMultiplier` = `0x4bd27648`.

The multiplier uses **18 decimals** (`1e18` = 1.0x). Stock tokens are **not rebasing** — `balanceOf()` never changes as a result of a corporate action; only the logical share count implied by the multiplier does.

`newUIMultiplier()` and `effectiveAt()` are the load-bearing pair for Aarka. Because a corporate action is announced with a future effective timestamp, Aarka can see one coming and refuse to create a series that would expire inside it, rather than discovering it after the fact.
