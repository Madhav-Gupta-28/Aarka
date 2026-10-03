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
- [Appendix A — Verified feed data](#appendix-a--verified-feed-data)
- [Appendix B — Verified stock tokens](#appendix-b--verified-stock-tokens)

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

---

## 4. Why corporate actions do not require strike adjustment

This is the least obvious result in the design and it removes an entire class of complexity, so it is worth proving rather than asserting.

### The problem in traditional markets

A listed option struck at $200 on a stock that does a 2-for-1 split would be worthless overnight if nothing were done — the share price halves to $100 and the call never comes back into the money. Exchanges therefore run an adjustment process: the OCC rewrites strike and contract size on every split, special dividend, spin-off and merger. It is fiddly, it is a common source of disputes, and replicating it on-chain would be the hardest part of this protocol.

Aarka does not have to.

### The proof

Let `E` be the underlying equity price and `M` the ERC-8056 multiplier. Chainlink publishes the **token** price:

```
P = E x M
```

**Stock split, 2-for-1.** The equity price halves and the multiplier doubles, because one token now represents twice as many shares:

```
P' = (E / 2) x (2M) = E x M = P
```

**Cash dividend, reinvested.** On the ex-date the equity price drops by the dividend `D`. Robinhood reinvests, so each token comes to represent more shares by the factor `E / (E - D)`:

```
P' = (E - D) x M x E / (E - D) = E x M = P
```

In both cases the token price is **unchanged across the event**. The multiplier exists precisely to absorb the discontinuity in `E` so that `P` stays continuous.

### The consequence

Aarka's strike `K` is denominated in the token price `P`, which is the quantity Chainlink publishes. Since `P` is continuous through splits and reinvested dividends, **`K` needs no adjustment for them.** The Robinhood stock token is a total-return instrument, and a strike written against a total-return instrument is already whole.

This is why [§3.5](#35-chainlink-feeds) matters so much. If Aarka applied the multiplier itself, it would double-count it and every settlement after a corporate action would be wrong. The correct code is the code that does nothing.

### Where the result stops

The proof holds for any corporate action a **scalar multiplier can express**. It does not hold for actions that transfer value out of the instrument entirely — a spin-off hands shareholders stock in a new company, and no single number on the original token can represent that.

Robinhood's own contract acknowledges this. Its documentation describes two update paths: small updates with no price discontinuity, applied immediately; and **large updates with price discontinuity, which require a scheduled pause window and manual confirmation before unpause.**

So the rule Aarka implements is:

- **Continuous multiplier changes** (splits, reinvested dividends) — ignore entirely. The proof above covers them.
- **Discontinuous changes** (announced via `newUIMultiplier()` / `effectiveAt()`, or signalled by `oraclePaused()`) — refuse to settle, and refuse to create new series that would expire inside the window. See [§7.4](#74-corporate-action-guard).

The design does not attempt to price a spin-off. It detects one and steps out of the way, leaving `redeem()` — which is always value-neutral — as the exit.

---

## 5. Contract architecture

Five contracts. No proxies, no upgradeability, no admin key over user funds.

```
                       AarkaFactory
                   (asset registry, series creation)
                             |
              +--------------+--------------+
              |                             |
       ExpiryCalendar                  AarkaSeries              <- one per (underlying, strike, expiry)
    (valid expiry timestamps)          /          \
                                 AarkaToken    AarkaToken
                                   (floor)       (upside)

                       AarkaParityHook            <- Module 2, optional, isolated
                    (Uniswap v4 afterSwap)
```

### 5.1 AarkaSeries — the vault

One instance per `(underlying, strike, expiry)` triple. It holds the deposited stock tokens and nothing else. It is **immutable and isolated**: a series has no knowledge of any other series, shares no storage, and cannot be drained by a failure elsewhere. There is no cross-collateralisation because there is no collateral — only deposits.

```solidity
interface IAarkaSeries {
    // --- immutable identity ---
    function underlying() external view returns (IERC20);
    function feed() external view returns (AggregatorV3Interface);
    function strike() external view returns (uint256);   // 8 decimals, matches the feed
    function expiry() external view returns (uint64);    // unix seconds
    function floorToken() external view returns (IAarkaToken);
    function upsideToken() external view returns (IAarkaToken);

    // --- lifecycle ---
    function mint(uint256 amount, address to) external;
    function redeem(uint256 amount, address to) external;          // always open
    function settle(uint80 roundId) external;
    function challengeSettlement(uint80 betterRoundId) external;
    function claimFloor(uint256 amount, address to) external returns (uint256 paid);
    function claimUpside(uint256 amount, address to) external returns (uint256 paid);

    // --- settlement state ---
    function settled() external view returns (bool);
    function settlementPrice() external view returns (uint256);      // 8 decimals
    function floorPayoutPerUnit() external view returns (uint256);   // 18 decimals
    function upsidePayoutPerUnit() external view returns (uint256);  // 18 decimals
    function claimsUnlockAt() external view returns (uint64);
}
```

All of `underlying`, `feed`, `strike`, `expiry`, `floorToken` and `upsideToken` are Solidity `immutable`. They live in bytecode, cost no storage read, and cannot be changed by anyone including the deployer.

The two token contracts are deployed inside the series constructor, so the series learns their addresses without a circular dependency and each token learns its series from `msg.sender`.

### 5.2 AarkaToken — the halves

A deliberately minimal ERC-20. `mint` and `burn` are callable only by the series that deployed it. It has no owner, no pause, no blocklist and no upgrade path.

```solidity
interface IAarkaToken is IERC20 {
    function series() external view returns (address);
    function mint(address to, uint256 amount) external;   // onlySeries
    function burn(address from, uint256 amount) external; // onlySeries
}
```

Naming follows the Pendle convention, which the market already reads:

```
symbol   fNVDA-200-26SEP26                uNVDA-200-26SEP26
name     Aarka Floor NVDA 26SEP26 $200.00  Aarka Upside NVDA 26SEP26 $200.00
```

The strike is in both. An earlier version kept it out of `symbol()` to keep symbols short, and on testnet that gave the $210 and $230 floor tokens the same symbol, `fNVDA-30OCT26`. Wallets and token lists show the symbol, and the strike is the one term a user must not get wrong, so it goes there too (AUDIT-17). A whole-dollar strike renders without cents, `fNVDA-212.50-26SEP26` otherwise, and the factory refuses sub-cent strikes so no two series can render the same.

The `f` and `u` prefixes are deliberate. The `m` prefix was rejected because Mirror Protocol's `mAAPL` and `mTSLA` are the direct subject of an SEC enforcement action, and inheriting that association would be an unforced error for a product built on tokenized equities.

### 5.3 AarkaFactory — creation and the asset registry

```solidity
interface IAarkaFactory {
    function createSeries(address underlying, uint256 strike, uint64 expiry)
        external returns (address series);

    function seriesFor(address underlying, uint256 strike, uint64 expiry)
        external view returns (address);          // CREATE2 address, deployed or not

    function feedFor(address underlying) external view returns (address);
    function isSeries(address) external view returns (bool);
}
```

Series are deployed with `CREATE2` under `salt = keccak256(abi.encode(underlying, strike, expiry))`, so the address is a pure function of the terms. A duplicate series is impossible — the second deployment reverts on address collision — and any integrator can compute a series address off-chain without a subgraph.

**Creation is permissionless in one dimension and governed in the other.** Anyone may create any `(strike, expiry)` pair. Nobody may choose the price feed: the factory looks it up from a governed `underlying -> feed` registry, and reverts if the asset is not registered.

This split is the important security decision in the factory. The dangerous freedom is not "what strike" — a silly strike hurts only the person who uses it, and the series is isolated. The dangerous freedom is "what feed," because a series pointed at an attacker-controlled feed is a machine for stealing the deposit. So that one degree of freedom is removed and every other one is left open.

Creation additionally requires:

| Check | Reason |
| --- | --- |
| `feedFor(underlying) != 0` | asset is registered |
| `feed.decimals() == 8` | strike and price share a base ([§6](#6-integer-arithmetic-and-rounding)) |
| `calendar.isValidExpiry(expiry)` | expiry is a real market close ([§7.5](#75-expiry-timing)) |
| `expiry >= block.timestamp + MIN_TENOR` | no same-block expiries |
| `expiry <= block.timestamp + MAX_TENOR` | bounds oracle risk |
| `0 < strike <= MAX_STRIKE` | overflow bound, see [§6](#6-integer-arithmetic-and-rounding) |
| no corporate action scheduled before expiry | [§7.4](#74-corporate-action-guard) |
| `!oraclePaused()` | asset is not mid-event |
| strike within `[spot/5, spot*5]` | fat-finger guard, not a safety property |

### 5.4 redeem() is permanent

`redeem()` — return one floor and one upside token, receive one underlying — is **never disabled**. Not at expiry, not after settlement, not if the oracle dies.

This is safe because of the conservation result in [§2](#2-the-payoff-proven). After settlement the two halves are worth `floorPayoutPerUnit + upsidePayoutPerUnit`, which is exactly `1e18` by construction ([§6](#6-integer-arithmetic-and-rounding)). Redeeming the pair for one underlying therefore pays exactly what claiming both halves separately would pay, minus the rounding dust. It can never pay more.

The consequence is the protocol's escape hatch, and it costs nothing to provide:

> **If the oracle is permanently broken, no funds are stuck.** Anyone holding both halves withdraws their stock token at any time. No admin, no timelock, no emergency multisig, no governance vote.

That covers pairs. It does **not** cover someone holding one half, who can only get out by buying the other on an AMM that may be empty. For them the guarantee is that settlement always eventually happens — see [§8.4](#84-if-settlement-never-happens). An earlier version of this section treated `redeem()` as the whole escape hatch, and that is how the six-hour settlement window's stranding risk went unnoticed (AUDIT-16).

There is no `pause()` on a series and no privileged withdrawal. That is not an oversight; it is the reason none is needed.

### 5.5 ExpiryCalendar

A governed list of valid expiry timestamps.

```solidity
interface IExpiryCalendar {
    function isValidExpiry(uint64 timestamp) external view returns (bool);
    function addExpiries(uint64[] calldata timestamps) external;   // onlyGovernance
}
```

An expiry must avoid weekends and market holidays, when the feed stops publishing entirely ([§7.5](#75-expiry-timing)), and by convention lands on the 16:00 ET close. Neither condition can be computed on-chain: both depend on the NYSE holiday calendar, on early-close days, and on US daylight saving transitions, which move 16:00 ET between 20:00 and 21:00 UTC.

Hard-coding a UTC cadence would silently drift by an hour twice a year and would settle on Thanksgiving. Publishing the calendar is the honest solution and it is what exchanges themselves do.

Governance can only **add** timestamps. It cannot remove one, so a series that already exists can never have its expiry invalidated. The worst a hostile calendar operator can do is refuse to add future dates, which stops new series from being created and does nothing to existing ones.

---

## 6. Integer arithmetic and rounding

The entire solvency argument is here. It has to be exactly right.

### 6.1 The payout constants

At settlement, with price `S` (8 decimals) and strike `K` (8 decimals):

```solidity
uint256 constant ONE = 1e18;

// floor: min(S, K) / S, rounded DOWN
uint256 fp = Math.mulDiv(Math.min(S, K), ONE, S);   // in [0, 1e18]

// upside: the exact complement, never computed independently
uint256 up = ONE - fp;
```

**The upside leg is defined as the complement, not as `max(0, S-K)/S`.** Computing both by division would give two independently-floored values whose sum could be `1e18 - 1`, permanently stranding dust and, worse, making the sum a value that has to be reasoned about rather than known. Defining `up = ONE - fp` makes

```
fp + up == 1e18     exactly, by construction, in every case
```

an identity the compiler enforces rather than a property the tests hope for.

**Bound check.** `fp <= 1e18` always:
- if `S <= K` then `min(S,K) = S` and `mulDiv(S, 1e18, S) = 1e18` exactly, so `up = 0`;
- if `S > K` then `min(S,K) = K < S`, so `mulDiv(K, 1e18, S) < 1e18`, so `up > 0`.

`ONE - fp` therefore never underflows.

`Math.mulDiv` (OpenZeppelin) computes the 512-bit intermediate product, so `min(S,K) * 1e18` cannot overflow regardless of inputs. The `MAX_STRIKE` bound in [§5.3](#53-aarkafactory--creation-and-the-asset-registry) is defence in depth, not the primary protection.

### 6.2 Per-holder claims

```solidity
paid = Math.mulDiv(amount, fp, ONE);   // or up, floored, always down
```

Every claim rounds **down**. The remainder stays in the vault. No claim path rounds up, anywhere, ever.

### 6.3 The solvency proof

Let `N` be the supply of each token at the moment of settlement. Invariant **I1** ([§13](#13-invariants)) gives `floorSupply == upsideSupply == underlying.balanceOf(series) == N` at that instant.

Each unit of floor token can be burned exactly once, for at most `fp / 1e18` of the underlying. Each unit of upside token likewise, for at most `up / 1e18`. Redeeming a pair burns one of each and pays exactly `1`, which equals `(fp + up) / 1e18`. So every exit path pays at most the linear bound, and:

```
total paid  <=  (N x fp + N x up) / 1e18
            =   N x (fp + up) / 1e18
            =   N x 1e18 / 1e18
            =   N
            =   underlying.balanceOf(series)
```

with strict inequality whenever any claim floors. **The vault can never pay out more than it holds, at any price, in any order, under any mix of claim and redeem.** The residue is dust that stays in the contract permanently; there is no sweep function, because a sweep would be a privileged withdrawal path and the protocol does not have one.

### 6.4 Decimals, written out

```
underlying amount   18 decimals
feed price S         8 decimals
strike K             8 decimals   <- deliberately matched to the feed
payout per unit     18 decimals   <- a ratio, base 1e18
uiMultiplier        18 decimals   <- read as a signal only, never multiplied in
USDG                 6 decimals   <- Module 2 and front end only
```

`S` and `K` share a base, so `min(S, K)` is a direct comparison with no scaling. This is the reason the factory rejects any feed whose `decimals()` is not 8: a 18-decimal feed would make `min(S,K)` compare a price against a number 10^10 times smaller and silently settle every series at the floor.

### 6.5 Deposit accounting

`mint()` measures the balance before and after the transfer and mints the **observed delta**, not the requested amount:

```solidity
uint256 before = underlying.balanceOf(address(this));
underlying.safeTransferFrom(msg.sender, address(this), amount);
uint256 received = underlying.balanceOf(address(this)) - before;
floorToken.mint(to, received);
upsideToken.mint(to, received);
```

Robinhood stock tokens are plain ERC-20s with no transfer fee, so `received == amount` today. The delta pattern costs one extra `SLOAD` and makes invariant I1 hold by construction rather than by assumption — if the token ever gains a transfer fee, or if a series is somehow pointed at a token that has one, the vault stays solvent instead of over-minting.

---

## 7. The oracle layer

A tokenized-equity feed is not a crypto feed and cannot be read like one. Four of the six guards below exist because of properties specific to Robinhood's feeds, and a project that reads `latestRoundData()` the way it would read ETH/USD will settle wrong prices on quiet days without ever reverting.

### 7.1 The naive read is wrong

```solidity
(, int256 price,,,) = feed.latestRoundData();   // never do this
```

Three separate failures:

1. **It has no staleness check.** Robinhood equity feeds are 24/5 and, in Chainlink's words, "do not have heartbeats during off-hours." At 3am on a Sunday the call succeeds and returns Friday's close. Nothing reverts.
2. **It reads the price now, not the price at expiry.** Whoever calls `settle()` chooses when, and therefore chooses the price. A caller who waits for a favourable move steals from the other leg. Settlement must be pinned to expiry, not to the transaction.
3. **It ignores the sequencer.** On an Orbit L2 a stalled sequencer freezes feed updates while every read keeps succeeding.

### 7.2 Price validity

```solidity
require(answer > 0, "invalid price");      // an equity price is never zero or negative
require(updatedAt != 0, "incomplete round");
```

`answer` is `int256` and must be cast only after the positivity check.

### 7.3 Sequencer uptime

Robinhood Chain is an Arbitrum Orbit L2. Chainlink's L2 pattern applies:

```solidity
(, int256 seq, uint256 startedAt,,) = sequencerUptime.latestRoundData();
require(seq == 0, "sequencer down");                        // 0 = up, 1 = down
require(block.timestamp - startedAt > GRACE_PERIOD, "grace period");
```

`GRACE_PERIOD` is 3600 seconds. The grace period exists because the instant a sequencer restarts, users who were unable to transact during the outage have not yet had a chance to react, while the feed has already caught up. Settling in that window would execute against a price that nobody could trade at.

The sequencer uptime feed address on Robinhood Chain is **UNVERIFIED** — see [§15](#15-open-items). Until it is confirmed, the series takes it as a constructor argument and skips the check when the address is zero, with that fact emitted in an event at deployment so it is visible on-chain rather than hidden in a config file.

### 7.4 Corporate action guard

Read as a **signal**, never as a price input ([§3.5](#35-chainlink-feeds), [§4](#4-why-corporate-actions-do-not-require-strike-adjustment)).

At **series creation** the factory requires:

```solidity
!oraclePaused()                                    // not mid-event right now
effectiveAt() == 0 || effectiveAt() > expiry       // no announced action inside the tenor
```

`newUIMultiplier()` / `effectiveAt()` are ERC-8056's required pending-multiplier extension, and they are what make this checkable in advance: a corporate action is announced with a future effective timestamp, so a series can simply refuse to be written across one.

`oraclePaused()` is a Robinhood addition, not part of ERC-8056, so the factory probes it with a `staticcall` at creation and records whether it exists as an immutable flag on the series. A missing function is recorded as absent rather than treated as an error, so the protocol still works if Robinhood ships a token without it.

At **settlement** the series requires `!oraclePaused()` again.

### 7.5 Expiry timing, and why the lookback bound is the real pause detector

**A correction to an earlier draft of this document.** It previously claimed expiries must fall at a US market close "because that is the only moment the feed is reliably fresh." Measurement showed that is false, and the real behaviour is better. `us_equities_24/5` means the feed publishes **around the clock, five days a week** — not during market hours only. Rounds 862–867 in [Appendix A.2](#a2-measured-round-cadence-nvda) land between 17:04 and 17:08 ET, after the close, tracking an after-hours earnings move of $212.71 to $219.43 in four minutes. Rounds 880–889 land between 02:12 and 08:54 ET. The feed only goes dark at the weekend.

So the freshness constraint is narrower than stated: **do not expire on a weekend or a market holiday.** Within the 24/5 window the feed is live.

Expiries are nonetheless still pinned to the 16:00 ET close, for two reasons that are honest about what they are — convention, not necessity. It is the price every quote screen, every options chain and every user already means by "the closing price," and it is the moment of deepest liquidity in the underlying. Neither is a safety property.

One consequence worth stating: a series expiring at 16:00 ET on an earnings day settles on the **pre**-announcement price, and the after-hours move accrues entirely to whoever holds the tokens afterwards. That is correct and intended, but it must be visible in the interface, because a user who expects an earnings print to be inside their series will otherwise be surprised by their own position.

The settlement round must then satisfy:

```solidity
require(updatedAt <= expiry, "round is after expiry");
require(expiry - updatedAt <= MAX_SETTLEMENT_AGE, "round too far before expiry");
```

> **Superseded, 15 September 2026.** The bound below was 6 hours. It is now **26 hours**, `MAX_SETTLEMENT_AGE`, with a late path after 7 days. The six-hour reasoning is kept because it explains the mistake. Robinhood Chain's equity feeds publish on a **0.5% deviation or a 24-hour heartbeat**, so a calm session produces no rounds at all. SPY's last round before the 11 September close was 7.1 hours old, so a SPY series expiring that day could never have settled, and a holder of one half had no way out. The 111-round sample below was one ticker in an earnings week, which is exactly the bias this section warned about. Until the next round, the last price is within 0.5% of the market by the feed's own definition, so a heartbeat-old round is accurate; the pause the six-hour bound used to detect by silence is now checked directly, together with any ERC-8056 action that landed after the round. See [§8.1](#81-pinning-the-round) and AUDIT-16.

`MAX_SETTLEMENT_LOOKBACK` was **6 hours**, and the value was empirical rather than assumed. A regular US session runs 09:30 to 16:00 ET, so a six-hour bound guarantees the settlement round was published **during the same trading session** as the close it settles against.

Measured against 111 consecutive live rounds of the NVDA feed ([Appendix A.2](#a2-measured-round-cadence-nvda)):

```
largest observed intra-session gap    9,454 s   =  2.63 h
median  intra-session gap             1,081 s   = 18 min
largest observed overnight gap       48,165 s   = 13.38 h
```

Six hours clears the worst observed intra-session gap by **2.3x** while sitting comfortably below the 13.4-hour overnight gaps that must be rejected. The bound is neither tight enough to fail on a quiet afternoon nor loose enough to accept a price from the previous session.

This single bound does more work than it appears to, and it is worth being explicit about why:

> **The lookback bound is also the corporate-action pause detector.** While `oraclePaused()` is true the feed stops publishing. If expiry falls inside a pause, no round exists within six hours before it, so `settle()` reverts on its own. No historical pause lookup is required, and none is possible on-chain anyway.

It is likewise the off-hours detector, the sequencer-outage detector, and the feed-deprecation detector. Any condition that stops the feed from publishing near expiry blocks settlement, and blocked settlement is safe because `redeem()` is permanent ([§5.4](#54-redeem-is-permanent)).

The tradeoff is stated plainly: too tight a bound makes settlement fail on quiet days; too loose accepts a price from a different session. Six hours is the value at which the bound is provably within one session.

### 7.6 Feed decimals

Checked at creation **and** re-checked at settlement:

```solidity
require(feed.decimals() == 8, "unexpected feed decimals");
```

A Chainlink proxy can be repointed to a new aggregator by Chainlink governance. Decimals are stable in practice, but a series that settles a strike expressed in 8 decimals against an 18-decimal price would compute `min(S, K) = K` for every conceivable price and pay the entire vault to the floor leg. The re-check costs one `STATICCALL` and removes a total-loss scenario.

---

## 8. Settlement

### 8.1 Pinning the round

`settle()` takes a `roundId` rather than reading the latest price. The caller supplies a candidate; the contract proves it is the right one.

```solidity
function settle(uint80 roundId) external {
    require(block.timestamp >= expiry, "not expired");
    require(!settled, "already settled");
    _requireSequencerUp();
    _requireFeedSane();          // decimals == 8, not oraclePaused
    (uint256 S, uint256 updatedAt) = _readRound(roundId);

    require(updatedAt <= expiry,                             "round after expiry");
    _requireIsLastRoundAtOrBefore(roundId, expiry);

    // Normal path. A week after expiry these stop applying, so every series resolves.
    if (block.timestamp < expiry + LATE_SETTLEMENT_DELAY) {
        require(expiry - updatedAt <= MAX_SETTLEMENT_AGE,    "round too old");   // 26 hours
        require(!corporateActionBetween(updatedAt, expiry),  "action after round");
        // plus the sequencer and oraclePaused checks above
    }

    settlementPrice      = S;
    settlementUpdatedAt  = updatedAt;
    floorPayoutPerUnit   = Math.mulDiv(Math.min(S, strike), 1e18, S);
    upsidePayoutPerUnit  = 1e18 - floorPayoutPerUnit;
    claimsUnlockAt       = uint64(block.timestamp) + CHALLENGE_PERIOD;
    settled              = true;
    emit Settled(roundId, S, updatedAt, floorPayoutPerUnit);
}
```

`_requireIsLastRoundAtOrBefore` checks that round `roundId + 1` either does not exist or was published after expiry:

```solidity
try feed.getRoundData(roundId + 1) returns (uint80, int256, uint256, uint256 nextUpdatedAt, uint80) {
    if (nextUpdatedAt != 0) require(nextUpdatedAt > expiry, "a later round exists at or before expiry");
} catch {
    // no successor round: roundId was the latest. Accept.
}
```

The `try/catch` is required, not defensive padding. A Chainlink proxy `roundId` is the composite `(phaseId << 64) | aggregatorRoundId`. At a phase boundary — which happens when Chainlink migrates the underlying aggregator — `roundId + 1` is a well-formed identifier that does not exist, and `getRoundData` reverts rather than returning zeros. Without the catch, every series whose expiry lands near an aggregator migration would be permanently unsettleable.

### 8.2 The challenge window

The phase-boundary case above is exactly where the pinning check is weakest: a caller could present the last round of an old phase and have the successor check pass vacuously, even though a later, more correct round exists in the new phase.

So settlement is provisional for `CHALLENGE_PERIOD` (1 hour), during which anyone may replace it with a strictly better round:

```solidity
function challengeSettlement(uint80 betterRoundId) external {
    require(settled && block.timestamp < claimsUnlockAt, "window closed");
    (uint256 S2, uint256 u2) = _readRound(betterRoundId);
    require(u2 <= expiry,                "after expiry");
    require(u2 >  settlementUpdatedAt,   "not an improvement");
    // recompute price and payout constants; claimsUnlockAt is NOT extended
}
```

Three properties make this safe:

- **It converges.** Every successful challenge strictly increases `settlementUpdatedAt`, and only finitely many rounds precede expiry, so the process terminates at the true last round.
- **It is monotone.** Settlement can only move *towards* expiry, never away. There is no way to walk the price backwards to a more favourable time.
- **It is bounded.** A challenge does not extend `claimsUnlockAt`, so no amount of challenging can delay claims beyond one hour.

The lookback bound needs no re-check during a challenge: any round later than one that already passed it is necessarily closer to expiry.

Claims unlock at `claimsUnlockAt`. `redeem()` is unaffected and remains open throughout — a holder of both halves never waits for a challenge window.

### 8.3 Claiming

```solidity
function claimFloor(uint256 amount, address to) external returns (uint256 paid) {
    require(settled && block.timestamp >= claimsUnlockAt, "not claimable");
    floorToken.burn(msg.sender, amount);
    paid = Math.mulDiv(amount, floorPayoutPerUnit, 1e18);
    underlying.safeTransfer(to, paid);
}
```

`claimUpside` is identical with `upsidePayoutPerUnit`. Both round down ([§6.2](#62-per-holder-claims)). Burning before transferring follows checks-effects-interactions; the underlying is a plain ERC-20 with no callback, but the ordering is free.

A `paid` of zero is legal and does not revert — an upside token that finished out of the money is genuinely worth nothing, and reverting would leave holders unable to burn a worthless token out of their wallet.

### 8.4 If settlement never happens

It always does. The normal path needs a round within 26 hours of expiry, the sequencer up, the asset unpaused and no corporate action after the round. When one of those fails, it keeps failing for at most `LATE_SETTLEMENT_DELAY` (7 days). After that, settlement accepts the last round at or before expiry at any age and ignores the sequencer and the pause; it still pins the round and still requires 8 decimals, because a mis-scaled price is not late, it is wrong. The series records `settledLate` so the path taken is visible on chain.

The earlier answer here was "`redeem()` stays open, so nothing is stuck." That was true for pairs and false for the people the product is for — someone who split a share and sold one half. A late price is a worse price. No price, for them, is a total loss (AUDIT-16).

---

## 9. Governance and its limits

Governance is a single `owner` address, intended to be a multisig, with exactly three powers:

| Power | Effect | Bounded by |
| --- | --- | --- |
| `registerAsset(underlying, feed)` | allows new series on an asset | cannot change an existing series; series store the feed as an immutable |
| `addExpiries(uint64[])` | adds valid expiry dates | add-only; cannot invalidate an existing series |
| `setCreationPaused(bool)` | stops new series being created | does not touch existing series at all |

What governance **cannot** do, by construction rather than by policy:

- move, freeze, or withdraw a single token from any series;
- change a strike, an expiry, a feed, or a payout on a series that exists;
- pause `mint`, `redeem`, `settle`, or `claim` on a series that exists;
- upgrade any contract — there are no proxies anywhere in the system;
- prevent settlement, or force one.

The strongest attack available to a fully compromised owner key is to register a malicious feed and mislead users into depositing into a *new* series. Every series created before the compromise is untouched, because the feed is baked into bytecode at deployment. The blast radius of the admin key is bounded to assets registered after the key is stolen.

Front ends should surface `series.feed()` and let a user confirm it against Chainlink's published address before depositing. That check is the entire trust assumption in the system, and it is one `eth_call`.

---

## 10. User flows

### 10.1 The holder who wants cash for the upside

Owns 100 NVDA tokens at $215. Does not expect it to go far past $230, and would rather be paid for that part today.

```
1. mint(100)                  -> 100 fNVDA-26SEP  +  100 uNVDA-26SEP
2. sell 100 uNVDA on Uniswap  -> receives USDG today
3. holds 100 fNVDA
```

They now hold a position worth `min(S, K)` at expiry plus cash received up front. They have sold the upside above $230 and been paid for it immediately. Nothing can be liquidated, and there is no margin to maintain.

What this is not: downside protection. The floor half takes every dollar of a fall exactly as the stock would. The only cushion is the cash received for the upside. In options terms this is a covered call, and it should never be described as a hedge.

This is the flow that makes the protocol bootstrap **single-sided**. The user needs no counterparty, no order book, and no capital beyond the shares they already owned. They are not depositing to earn a fee; they are restructuring a position they already have and taking cash for the part they did not want.

### 10.2 The buyer who wants leverage without borrowing

Wants exposure to NVDA above $230 and has $500.

```
1. buy uNVDA-26SEP on Uniswap with USDG
2. hold to expiry, or sell any time
3. claimUpside() -> max(0, S - K) / S of a token
```

Convex exposure, capped loss at the purchase price, no borrowing, no liquidation price, no funding rate, no maintenance margin. The token cannot be taken from them by an adverse move — the worst case is that it settles at zero, which was known and bounded when they bought it.

Contrast with the leveraged perp wrapper this competes against: linear payoff, liquidatable, and a funding rate that runs against the holder.

### 10.3 The arbitrageur

Enforces the identity `P(f) + P(u) = P(NVDA)`.

```
if  P(f) + P(u)  >  P(NVDA):    buy NVDA, mint, sell both halves
if  P(f) + P(u)  <  P(NVDA):    buy both halves, redeem, sell NVDA
```

Both directions are **risk-free against the vault**, because mint and redeem are exactly 1:1 at all times with no fee and no price dependence. The only risk is execution on the AMM legs. This is the flow Module 2 internalises.

### 10.4 What price discovery actually looks like

Mint and redeem arbitrage enforce the **sum**. They say nothing about the **split**.

Where `P(f)` sits relative to `P(u)` is a market opinion about volatility, and the first minter of a series is a price-setter rather than a price-taker. This is a real cold-start problem and should not be papered over.

The front end shows an indicative Black-Scholes reference, computed off-chain, **clearly labelled as a model output and not a protocol price**. No contract reads it. It exists so that the first minter has a reference point, not because the protocol has an opinion about fair value.

---

## 11. Module 2 — the Uniswap v4 parity hook

**This module is strictly optional.** The core protocol in §1–§10 is complete, deployable and useful without it. Module 2 is isolated so that a bug in it, or a failure to finish it, cannot affect a single deposited token. Read that as a deliberate risk decision, not a disclaimer.

### 11.1 The problem it solves

Mint and redeem enforce the sum. Nothing enforces the split. Three pools exist:

```
P1   NVDA  / USDG      already liquid on Robinhood Chain
P2   fNVDA / USDG      created by Aarka
P3   uNVDA / USDG      created by Aarka
```

and `P(f) + P(u) = P(NVDA)` must hold or there is free money on the table. Today that money leaks to whichever searcher is fastest. The hook captures it and gives it to the liquidity providers instead.

### 11.2 Why this is not just another LVR hook

Every arbitrage-capture hook built so far — dynamic-fee designs, auction designs — is trying to capture arbitrage against an **external** reference price it can only estimate. It is guessing at fair value. It can therefore only ever recapture a fraction, and it carries the risk of guessing wrong.

Aarka does not guess. **The vault defines the relationship.** Mint and redeem are exactly 1:1, unconditionally, at any price, with no fee. So the arbitrage is *risk-free and internal*: there is no fair-value estimate anywhere in the trade, only an identity that the vault enforces by construction. The hook can capture 100% of it with certainty.

That is a claim no hook arbitraging against a CEX price can make, and it is the specific novelty being asserted here.

**Prior art, stated honestly.** The general pattern of a v4 hook detecting and executing arbitrage inside `afterSwap` is not new — `sterlingcrispin/arb-hook` is a public implementation. What I could not find prior art for is *identity-enforced redemption arbitrage on a structured-product pair*, which is the risk-free variant. The claim is the application, not the pattern, and it should be written up that way.

### 11.3 Verified v4 mechanics

Checked against `Uniswap/v4-core` tag `v4.0.0`, file `src/libraries/Hooks.sol`:

```solidity
uint160 internal constant AFTER_SWAP_FLAG = 1 << 6;    // 0x40
```

> **As deployed (29 Sep 2026):** the hook also takes `AFTER_ADD_LIQUIDITY_FLAG` and `BEFORE_REMOVE_LIQUIDITY_FLAG`, so its permission bits are `0x640`. They enforce a one-hour minimum liquidity age so the arbitrage donation cannot be sniped just in time (AUDIT-27). See [`AUDIT.md`](AUDIT.md).

Hook permissions are encoded in the **low 14 bits of the hook's own address**, so the hook must be deployed to a mined `CREATE2` address whose last bits match its declared permissions. Use `HookMiner` from `v4-periphery`. Budget half a day for this the first time; it is the single most common thing that derails a first v4 hook.

From `src/interfaces/IPoolManager.sol`, the four primitives the hook needs, verbatim:

```solidity
function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (BalanceDelta);
function donate(PoolKey memory key, uint256 amount0, uint256 amount1, bytes calldata hookData) external returns (BalanceDelta);
function sync(Currency currency) external;
function take(Currency currency, address to, uint256 amount) external;
function settle() external payable returns (uint256 paid);
```

`swap`, `take` and `settle` are all `onlyWhenUnlocked`. Inside `afterSwap` the PoolManager is **already unlocked**, so the hook calls them directly — it must not, and cannot, call `unlock()` again.

### 11.4 The flow

Installed on P2 and P3. On `afterSwap`:

1. Read `slot0` for all three pools. Three storage reads, cheap.
2. Compute the deviation of `P(f) + P(u)` from `P(NVDA)`. If it is under `MIN_DEVIATION_BPS`, return immediately. This gate is what keeps ordinary swaps cheap.
3. Execute the correction, in the profitable direction only:
   - **sum too high** — buy NVDA in P1, mint at the vault, sell both halves into P2 and P3
   - **sum too low** — buy both halves in P2 and P3, redeem at the vault, sell NVDA into P1
4. To touch the vault the hook needs *real tokens*, not deltas. `poolManager.take(NVDA, address(this), amount)` materialises them; after minting, `poolManager.sync(currency)` then transfer then `poolManager.settle()` returns the halves. This is exactly what `take`/`sync`/`settle` exist for.
5. `poolManager.donate(key, amount0, amount1, "")` pays the profit to in-range LPs.
6. Assert all deltas are settled and the round trip was net positive, or revert the whole thing.

### 11.5 The three ways this goes wrong, and the guards

**Same-pool reentrancy.** A hook calling `swap()` on the pool it is currently inside re-enters its own `afterSwap` and recurses until gas runs out. Guard: the hook touches only the *other two* pools, plus a transient-storage reentrancy flag. This is a hard invariant, tested explicitly.

**Manipulation-induced arbitrage.** An attacker skews P1 to make the hook trade badly. The vault leg cannot lose — it is 1:1 by construction — so the exposure is confined to the AMM legs. Guards: cap the hook's trade size per swap, and enforce **revert-unless-net-profitable** on the whole round trip. Under flash accounting that invariant is a single check on the summed deltas, and it means the hook cannot be induced into a losing trade at all.

**Displacement risk.** By internalising the arbitrage the hook removes the incentive for external searchers to do it. If the hook is ever disabled or gas-starved, parity drifts *further* than it would have without it. Mitigation: `mint()` and `redeem()` remain permissionless and unchanged, so the manual arbitrage path is always available. The hook is an optimisation over that path, never a replacement for it.

### 11.6 Sizing the arb: the optimum is the parity point

The first implementation traded a fixed `maxArbSize` and closed only part of the gap. Solving it
properly turned out to need no optimiser at all.

Profit in the mint direction is

```
  profit(s) = R_floor(s) + R_upside(s) - C_underlying(s)
```

Differentiating and setting to zero gives

```
  P_floor(s) + P_upside(s) = P_underlying(s)
```

which is the parity condition itself. **The profit-maximising size is exactly the parity-restoring
size.** There is no trade-off between "close the gap" and "make money" — they are the same number,
and the problem collapses from an optimisation to a root find.

The root is easy to bracket because the function is monotone: selling both halves pushes their
prices down while buying the underlying pushes its price up, so the gap shrinks with `s` and never
turns back. A 20-step binary search resolves it to about one part in a million of the cap.

Three implementation choices worth stating:

- **State is read once.** Each pool's `sqrtPriceX96` and `liquidity` are fetched before the search
  and the 20 steps run purely in memory, so a finer solve costs arithmetic rather than storage reads.
- **The search returns the last size at which the gap is still open**, stopping just short of the
  root rather than past it. Fees put the true optimum slightly below the zero-gap point, and
  undersizing leaves value for the next swap while oversizing loses money.
- **`SqrtPriceMath` from v4-core does the curve maths**, not a reimplementation. The search is
  capped at half of each pool's asset reserve so an exact-output leg can never ask for more than a
  pool holds, which would revert inside the library instead of returning a price.

Liquidity is treated as constant across the trade. That is exact for a full-range position and
close for a trade inside one tick range; a trade crossing initialised ticks is sized slightly high,
and the profitability check catches it.

### 11.6.1 Measured

Same pools, same swap, control run with the hook disabled:

```
                        no hook     fixed size     solved
halves become dear      633 bps       468 bps       0 bps
halves become cheap     633 bps       403 bps       1 bps
```

Parity is restored essentially completely, in the same transaction, before the user's swap returns.

Two further properties the tests assert rather than assume:

- **Size tracks the mispricing.** A 4x larger dislocation produced 27x the captured profit
  (63,646,889 vs 1,708,065,478 in quote units) — superlinear, because profit scales with gap times
  size and the solver moves both.
- **`maxArbSize` still binds.** Capped at one token against the same 633 bps gap, the hook closes
  it only to 627 bps. An operator can bound the hook's exposure regardless of what the maths wants.

### 11.7 The side effect worth advertising

Because the hook can route through mint and redeem, the three pools behave as **one liquidity surface**. A swapper going USDG to NVDA can be filled through the f and u pools when the direct pool is thin, and vice versa. The f and u pools become additional depth for the underlying rather than fragmenting it.

That is a genuine answer to the cold-start problem, not only a prize-shaped feature.

---

## 12. Threat model

### 12.1 Oracle manipulation
A Chainlink equity feed is not manipulable by an on-chain actor — there is no pool to push. The realistic oracle risks are **staleness** and **wrong-round selection**, handled in [§7](#7-the-oracle-layer) and [§8.1](#81-pinning-the-round).

### 12.2 Settlement timing
*Attack:* wait for a favourable move, then call `settle()` and capture the price for your leg.
*Defence:* `settle()` cannot read the current price at all. It pins the last round at or before expiry ([§8.1](#81-pinning-the-round)). The caller chooses *when* to transact and has no influence over *what price* results.

### 12.3 Wrong-round griefing at a phase boundary
*Attack:* present the last round of a superseded aggregator phase so the successor check passes vacuously.
*Defence:* the challenge window ([§8.2](#82-the-challenge-window)), which is monotone, convergent and time-bounded.

### 12.4 Decimals mismatch
*Attack:* a repointed Chainlink proxy returns 18 decimals; `min(S, K)` becomes `K` for every price; the entire vault pays the floor leg.
*Defence:* `feed.decimals() == 8` asserted at creation **and** re-asserted at settlement ([§7.6](#76-feed-decimals)).

### 12.5 Rounding extraction
*Attack:* loop tiny mints and redeems to extract dust.
*Defence:* mint and redeem are exactly 1:1 with no division, so there is no rounding in either. Division appears only in claims, and always rounds down ([§6](#6-integer-arithmetic-and-rounding)).

### 12.6 Reentrancy
Robinhood stock tokens are plain ERC-20s with no transfer hooks, so there is no callback surface. Checks-effects-interactions is followed regardless, `SafeERC20` is used throughout, and the balance-delta pattern in [§6.5](#65-deposit-accounting) makes the supply invariant hold even against a token that misbehaves.

### 12.7 The Friday Problem
The documented, structural reason the previous generation of on-chain options protocols died — Ribbon (became Aevo), Lyra (became Derive), Dopex (became Stryke). They auctioned inventory on a publicly known schedule, so volatility traders front-ran the auction; and they had no secondary market for that inventory, so it was force-sold into roughly five market makers. The result was systematic underpricing that compounded every week.

Aarka has **no auction, no schedule, and no market maker**, and the AMM is itself the secondary market. This is an economic risk that is designed out rather than managed, and it is the reason to believe this generation ends differently.

### 12.8 Cold start
The genuine open economic risk, stated without spin. Mint/redeem arbitrage fixes the sum from day one, but the *split* has no anchor until someone trades it. The first minter of each series is a price-setter. The mitigations are the indicative model in [§10.4](#104-what-price-discovery-actually-looks-like) and seeding each new series with a small two-sided position; neither is a guarantee.

### 12.9 Admin key compromise
Bounded by construction to assets registered *after* the compromise ([§9](#9-governance-and-its-limits)). No existing series can be touched.

### 12.10 Regulatory
This is a real risk for this product category and it is better to write it down than to discover it.

In December 2023 the SEC settled with BarnBridge DAO and its founders Tyler Ward and Troy Murray over the unregistered offer and sale of "structured crypto asset securities" — a total above **$1.7 million**, including **$125,000 personally from each founder**. The order cited social-media promotion of the returns and expressly rejected the argument that a "purportedly decentralized" DAO changed the analysis.

BarnBridge SMART Alpha is the closest structural analogue to Aarka that has been through an enforcement action, so the precedent is directly on point. The design responses that follow from it:

- the protocol takes **no fee** and issues **no governance token**, so there is no revenue stream to characterise as the return on a common enterprise;
- there is **no yield, no APY and no return figure** anywhere in the interface or the marketing;
- governance has no power over user funds and cannot be described as managing them ([§9](#9-governance-and-its-limits));
- promotional material describes the **mechanism**, never an expected return;
- the underlying Robinhood stock tokens are themselves restricted from US, Canadian, UK and Swiss persons, and the front end should not attempt to widen that distribution.

None of this is legal advice, and none of it is a defence. It is a list of the specific things the SEC cited in the one case that most resembles this one, and the specific design choices made in response.

---

## 13. Invariants

These are the properties the invariant test suite asserts. If any of them can be broken, the protocol is broken.

| # | Invariant | Where enforced |
| --- | --- | --- |
| **I1** | Before settlement: `floorSupply == upsideSupply == underlying.balanceOf(series)` | mint/redeem are strictly 1:1:1; [§6.5](#65-deposit-accounting) |
| **I2** | After settlement: `floorPayoutPerUnit + upsidePayoutPerUnit == 1e18` exactly | complement construction, [§6.1](#61-the-payout-constants) |
| **I3** | Total paid out over all exits never exceeds `underlying.balanceOf(series)` at settlement | floor-only rounding, [§6.3](#63-the-solvency-proof) |
| **I4** | `settle()` succeeds at most once; `settlementUpdatedAt` is non-decreasing and always `<= expiry` | [§8.1](#81-pinning-the-round), [§8.2](#82-the-challenge-window) |
| **I5** | `redeem()` succeeds in every reachable state, including unsettled, post-expiry and oracle-dead | [§5.4](#54-redeem-is-permanent) |
| **I6** | No caller can withdraw more underlying than the tokens they burn entitle them to, in any ordering | [§6.3](#63-the-solvency-proof) |
| **I7** | `strike`, `expiry`, `feed`, `underlying` never change after deployment | Solidity `immutable` |
| **I8** | Governance cannot reduce the underlying balance of any series | no privileged transfer path exists |

---

## 14. Test plan

**Unit.** Every guard, asserted to revert with the right custom error: stale round, round after expiry, round beyond the lookback, successor round before expiry, sequencer down, inside grace period, wrong decimals, paused oracle, corporate action scheduled inside the tenor, zero strike, expiry not on the calendar, unregistered asset, duplicate series.

**Payoff.** Table-driven over the boundaries — `S` far below `K`, `S = K - 1`, `S = K` exactly, `S = K + 1`, `S` far above `K`, `S` at the smallest representable price, `S` at `MAX_STRIKE`. Assert `f + u == 1e18` at each.

**Fuzz.** `mint`, `redeem`, `settle`, `claim` over random amounts, strikes, prices and orderings. 10,000 runs, configured in `foundry.toml`. The property under test is I3.

**Invariant.** A handler exposing mint / redeem / settle / challenge / claimFloor / claimUpside to a random actor set. 512 runs at depth 64, `fail_on_revert = false`. Asserts I1 through I8 after every call.

**Fork.** Against Robinhood Chain mainnet at a pinned block, using a real stock token and a real Chainlink feed. This is the test that catches the things a mock cannot: actual feed decimals, actual round cadence, actual `updatedAt` gaps across a weekend, actual `uiMultiplier` behaviour.

**Corporate action simulation.** Fork at a block before a real multiplier change, roll forward past it, and assert that settlement is unaffected — the empirical check on the proof in [§4](#4-why-corporate-actions-do-not-require-strike-adjustment). This is the highest-value test in the suite because it is the one that validates the least obvious claim.

**Module 2.** Same-pool reentrancy attempt must revert. Manipulated-P1 arbitrage must revert rather than execute at a loss. Deviation below threshold must be a no-op with bounded gas. Every delta settled at the end of every swap.

Target: 100% line and branch coverage on `src/`, enforced in CI via `forge coverage`.

---

## 15. Open items

Everything below must be resolved before mainnet. Each is a blocking item, not a nice-to-have.

| # | Item | Why it blocks | How to resolve |
| --- | --- | --- | --- |
| 1 | **Sequencer uptime feed address on Robinhood Chain** | [§7.3](#73-sequencer-uptime) guard cannot run without it | **MITIGATED, still their gap.** Re-checked 22 Sep 2026: 57 feeds on Robinhood Chain, 33 of them equities, no uptime feed. X Layer publishes one; this chain does not. Aarka now ships `AarkaSequencerFeed`, a stopgap in Chainlink's exact shape, written by the price keeper and wired through `setSequencerFeed`, so the guard runs. It fails closed — a stale report reads as down — and the trust it asks for is bounded: a hostile reporter can only delay settlement until `LATE_SETTLEMENT_DELAY`, which ignores the sequencer entirely. Retire it the day Chainlink publishes a real one. Still worth raising with Robinhood Chain developer support |
| 2 | ~~Chainlink feed proxy addresses per ticker~~ | — | **RESOLVED.** All 35 equity feeds in [Appendix A.1](#a1-equity-feed-proxy-addresses-chain-4663), from Chainlink's machine-readable directory |
| 3 | ~~Stock token addresses (mainnet)~~ | — | **RESOLVED.** 11 tokens verified on-chain, [Appendix B](#appendix-b--verified-stock-tokens). Testnet addresses remain unknown |
| 4 | **Testnet has neither feeds nor stock tokens** | a testnet deployment needs mock aggregators and mock tokens | **CONFIRMED EMPTY.** The NVDA feed and the NVDA token both have zero bytecode on chain 46630. Uniswap v4's PoolManager *is* there, at the mainnet address, so Module 2 can still be demonstrated on testnet |
| 5 | **`TransferWithUIAmount` vs `TransferWithScaledUI`** | cosmetic for the contracts, load-bearing for a subgraph | **STILL OPEN.** Neither topic hash appears in NVDA's recent logs, so this could not be settled by observation. Read the verified ABI from Blockscout |
| 6 | ~~Exact `oraclePaused()` signature~~ | — | **RESOLVED.** `oraclePaused()` returns cleanly on all 11 tokens, so the selector is right and the probe is live rather than silently skipped |
| 7 | **Feed round cadence during a quiet session** | validated the old `MAX_SETTLEMENT_LOOKBACK = 6 hours` | **RESOLVED, and it disproved the bound.** SPY went 7.1 h without a round before the 11 Sep 2026 close. Replaced by a 26-hour age plus a late path (AUDIT-16). Original note: Measured on NVDA over 111 rounds: worst intra-session gap 2.63 h, so 6 h holds with 2.3x headroom ([Appendix A.2](#a2-measured-round-cadence-nvda)). The sample week contained an earnings print, so re-run on a calm week and a low-volatility ticker before mainnet |
| 8 | **NYSE calendar for the first year of expiries** | [§5.5](#55-expirycalendar) needs concrete timestamps, DST-correct | generate from the published NYSE holiday calendar; unit-test both DST transitions |
| 9 | ~~v4-periphery `HookMiner`~~ | — | **RESOLVED.** Available at `v4-periphery/test/shared/HookMiner.sol`. Note there is no `BaseHook` in this version, so the hook implements `IHooks` directly |

---

## 16. Sources

Primary sources only. Every claim in this document traces to one of these or to a `cast` call reproducible from [§3](#3-verified-chain-facts).

- Robinhood Chain — Stock Tokens: `https://docs.robinhood.com/chain/stock-tokens/`
- Robinhood Chain — Building with Stock Tokens: `https://docs.robinhood.com/chain/building-with-stock-tokens/`
- Robinhood Chain — Contracts: `https://docs.robinhood.com/chain/contracts`
- Robinhood Chain — Oracles & Price Feeds: `https://docs.robinhood.com/chain/oracles-and-price-feeds`
- Chainlink — Robinhood Tokenized Equities: `https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood`
- Chainlink — Price Feed Addresses: `https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood`
- ERC-8056, Scaled UI Amount Extension: `https://eips.ethereum.org/EIPS/eip-8056`
- Uniswap v4 Deployments: `https://developers.uniswap.org/docs/protocols/v4/deployments`
- `Uniswap/v4-core` tag `v4.0.0` — `src/libraries/Hooks.sol`, `src/interfaces/IPoolManager.sol`
- SEC administrative proceeding, BarnBridge DAO / Tyler Ward / Troy Murray, December 2023

---

*Last verified against live RPC endpoints on 2026-08-29.*

---

## Appendix A — Verified feed data

Resolved on 2026-08-29 from Chainlink's machine-readable directory, which Robinhood's own documentation names as the source of truth:

```
https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json
```

57 feeds total on Robinhood Chain mainnet: **35 Robinhood tokenized equities** and 22 crypto/FX. Every equity feed shares identical parameters:

| Parameter | Value | Consequence for Aarka |
| --- | --- | --- |
| `decimals` | **8** | matches the strike base; the [§7.6](#76-feed-decimals) assertion is correct for all 35 |
| `heartbeat` | **86400 s (24 h)** | the heartbeat guarantees almost nothing. Freshness comes from the deviation threshold, not from the heartbeat, which is why [§7.5](#75-expiry-timing) had to be measured |
| deviation threshold | **0.5 %** | the real update trigger |
| `marketHours` | `us_equities_24/5` | **24 hours a day, 5 days a week** — not market hours only |

The 24-hour heartbeat is the number to keep in mind. A naive integrator who writes `require(block.timestamp - updatedAt < heartbeat)` would accept a price up to a full day old and believe they had implemented a staleness check.

### A.1 Equity feed proxy addresses (chain 4663)

| Feed | Proxy |
| --- | --- |
| Robinhood AAPL / USD | `0x6B22A786bAa607d76728168703a39Ea9C99f2cD0` |
| Robinhood AMD / USD | `0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72` |
| Robinhood AMZN / USD | `0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C` |
| Robinhood ASML / USD | `0xB4106147E8cce40b7d46124090d373A71b70f87D` |
| Robinhood BABA / USD | `0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984` |
| Robinhood CLSK / USD | `0x810c12D3a554Bc47fd39597Fe3b3AAC4941F50eF` |
| Robinhood COIN / USD | `0xA3a468A452940B7D6b69991207B508c609a98Ef2` |
| Robinhood CRCL / USD | `0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a` |
| Robinhood CRWV / USD | `0xe1b3aABCAFAd1c94708dc1367dcfF8Aa4407487C` |
| Robinhood DELL-USD | `0x1C6c8cADBe02E19129c39dDB92281cE4c0bf206b` |
| Robinhood EWY / USD | `0xEFdf54610B62A7753Ec30bDc380847c12D32e1D1` |
| Robinhood GME / USD | `0x27C71df6A64fB476468EdF256CF72c038baB5B67` |
| Robinhood GOOGL / USD | `0xF6f373a037c30F0e5010d854385cA89185AE638b` |
| Robinhood INTC / USD | `0x3f390C5C24628Ac7C489515402235FeAD71D1913` |
| Robinhood IONQ / USD | `0x22EfeC4919baf55F360E0EDee4AbEB26DE4971eb` |
| Robinhood META / USD | `0x7C38C00C30BEe9378381E7B6135d7283356D71b1` |
| Robinhood MSFT / USD | `0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E` |
| Robinhood MSTR / USD | `0x396118bdFB181e6240E74D243F266B061c0edc3D` |
| Robinhood MU / USD | `0x425EEFdCf05ed6526C3cE61Af99429A228a6d596` |
| Robinhood NBIS / USD | `0xE1D87B116Ba0fe898998f1D140339D1fA1E09705` |
| Robinhood NVDA / USD | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` |
| Robinhood ORCL / USD | `0x0e6a64a2B58A6693a531E6c555f3A5d042eEA844` |
| Robinhood PLTR / USD | `0x820ABedFF239034956B7A9d2F0a331f9F075eB4c` |
| Robinhood QQQ / USD | `0x80901d846d5D7B030F26B480776EE3b29374C2ae` |
| Robinhood RGTI / USD | `0x2A045cF1C49c61c166C036d2f06FA2D2d984f765` |
| Robinhood RKLB / USD | `0x045477BF65Aef6f4F2386ad0164579e48381CC74` |
| Robinhood SGOV-USD | `0xa0DF4ee0fFf975306345875E3548Fcc519577A11` |
| Robinhood SLV / USD | `0x209b73908e92Ae021826eD79609845451Ecba2ce` |
| Robinhood SNDK / USD | `0xfb133Fa4B7b385802B693a293606682Df47109A3` |
| Robinhood SPCX / USD | `0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb` |
| Robinhood SPY / USD | `0x319724394D3A0e3669269846abE664Cd621f9f6A` |
| Robinhood TSLA / USD | `0x4A1166a659A55625345e9515b32adECea5547C38` |
| Robinhood TSM / USD | `0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F` |
| Robinhood USAR-USD | `0xA994d3684e8400A6c8078226925779FdeE682DD9` |
| Robinhood USO / USD | `0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c` |

Also relevant:

| Feed | Proxy |
| --- | --- |
| BTC / USD | `0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251` |
| ETH / USD | `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` |
| USDG / USD | `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` |

56 of the 57 feeds also expose a `secondaryProxyAddress` on a `-shared-svr` path (Chainlink Smart Value Recapture, aimed at OEV recovery for lending protocols). **Aarka uses the primary `proxyAddress`.** SVR feeds exist to redirect liquidation value in borrowing markets; Aarka has no liquidations, so the secondary is irrelevant to it and using it would add a dependency for no benefit.

### A.2 Measured round cadence (NVDA)

`RHNVDA / USD` at `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`, 111 consecutive rounds, aggregator round 820 to 930, covering 2026-08-24 through 2026-08-28.

Round IDs on the proxy are the composite `(phaseId << 64) | aggregatorRoundId`. At the time of measurement `phaseId = 1` and the latest aggregator round was 930, i.e. roughly 930 rounds since the 1 July mainnet launch.

```
max intra-session gap (09:30-16:00 ET)     9,454 s   2.63 h
median intra-session gap                   1,081 s   18 min
max overnight gap (within the 24/5 window) 48,165 s  13.38 h
tightest observed cadence                     29 s   (post-earnings, 26 Aug)
```

Three things this measurement establishes:

1. **`MAX_SETTLEMENT_LOOKBACK = 6 h` is correct**, with 2.3x headroom over the worst observed intra-session gap and well under the overnight gaps that must be rejected.
2. **The feed is live outside market hours.** Rounds 862–867 span 17:04–17:08 ET on 26 August, tracking NVDA's post-close earnings move from $212.71 to $219.43 at a 29-second cadence. This is what falsified the earlier "market hours only" claim in [§7.5](#75-expiry-timing).
3. **Off-hours staleness is real and large.** Read live on Saturday 2026-08-29 12:28 UTC, `latestRoundData()` returned successfully with `updatedAt` **16.5 hours** in the past. Nothing reverted. This is [§7.1](#71-the-naive-read-is-wrong) demonstrated on mainnet rather than argued.

Reproduce:

```sh
cast call 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 \
  "latestRoundData()(uint80,int256,uint256,uint256,uint80)" \
  --rpc-url https://rpc.mainnet.chain.robinhood.com
```

**Sample caveat, stated because it matters.** This is one ticker over five trading days, and that week contained an NVDA earnings print, which biases the sample towards *more* frequent updates than normal. A quiet week in a low-volatility name could show longer gaps. The measurement should be re-run across several tickers and a calm period before mainnet, and `MAX_SETTLEMENT_LOOKBACK` re-derived from the widest gap observed then.

### A.3 The sequencer uptime feed is not published

[§7.3](#73-sequencer-uptime) needs an L2 sequencer uptime feed, and Robinhood's documentation explicitly instructs integrators to use one:

> "Because Robinhood Chain is a Layer-2, you should verify the sequencer is up before trusting a price — Chainlink provides an L2 Sequencer Uptime Feed for this."

**It is not in the directory.** `feeds-robinhood-mainnet.json` contains 57 feeds and none of them is a sequencer uptime feed. The same documentation names that directory as the source of truth and tells integrators never to hard-code addresses from anywhere else.

So the two instructions are in conflict, and this is a gap in Robinhood's documentation rather than a gap in the search. Until it resolves, Aarka takes the address as a constructor argument, skips the check when it is zero, and **emits that fact in a deployment event** so the missing guard is visible on-chain instead of buried in a config file. Resolving this is [open item 1](#15-open-items) and it should be raised directly with Robinhood Chain developer support.

---

## Appendix B — Verified stock tokens

Resolved 2026-08-29. Two independent sources agreed on these addresses, and every one was then
verified on-chain by calling `symbol()` and `decimals()` — a published address is not evidence.

All 11 are 18 decimals and all implement `uiMultiplier()`, `oraclePaused()` and `effectiveAt()`.

| Ticker | Address | `uiMultiplier()` |
| --- | --- | --- |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | `1e18` |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | `1e18` |
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | **`1000566080061092436`** |
| MSFT | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` | `1e18` |
| AMZN | `0x12f190a9F9d7D37a250758b26824B97CE941bF54` | `1e18` |
| GOOGL | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` | `1e18` |
| META | `0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35` | `1e18` |
| MSTR | `0xec262a75e413fAfD0dF80480274532C79D42da09` | `1e18` |
| COIN | `0x6330D8C3178a418788dF01a47479c0ce7CCF450b` | `1e18` |
| SPY | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | `1e18` |
| QQQ | `0xD5f3879160bc7c32ebb4dC785F8a4F505888de68` | `1e18` |

`NVDA.name()` is `"NVIDIA • Robinhood Token"`, not `"NVIDIA"`. Total supply at the time of reading
was 42,663 tokens, roughly $9.3M.

### B.1 The bug real data caught

**AAPL is the reason this appendix exists.** It is the only token in the set that has been through
a corporate action, and its live state is:

```
uiMultiplier()  1000566080061092436     a dividend, reinvested: +0.0566%
effectiveAt()   1786720366              a timestamp in the PAST
```

The factory's corporate-action guard was originally written as:

```solidity
if (effectiveAt != 0 && effectiveAt <= expiry) revert CorporateActionScheduled();
```

**Robinhood does not clear `effectiveAt` once an action has been applied.** It keeps the timestamp
of the last one. So for AAPL the first clause is permanently true, and since any valid future
expiry exceeds a past timestamp, the second is permanently true as well. That guard would have
made it impossible to ever create an AAPL series — and impossible for every asset, the moment it
paid its first dividend.

The corrected guard:

```solidity
if (effectiveAt > block.timestamp && effectiveAt <= expiry) revert CorporateActionScheduled();
```

Only a *pending* action matters. An action already applied is history, and by the proof in
[§4](#4-why-corporate-actions-do-not-require-strike-adjustment) it left the token price continuous
anyway, so there is nothing for the guard to protect against.

This is the single strongest argument for the fork tests. Every unit test passed against a mock
that behaved the way the specification said it should. Only the live contract behaved the way it
actually does. `test_appleWithAnAppliedDividendCanStillHaveASeries` now asserts the real state and
creates the series that used to be impossible.

### B.2 Testnet is empty

Chain 46630 has **neither the feeds nor the stock tokens** — both the NVDA feed proxy and the NVDA
token return zero bytecode there. A testnet deployment therefore needs mock aggregators and mock
tokens for the core protocol.

Uniswap v4's PoolManager *is* deployed on testnet, at the identical mainnet address, so
[Module 2](#11-module-2--the-uniswap-v4-parity-hook) can still be demonstrated there end to end.
