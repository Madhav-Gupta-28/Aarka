# Aarka — Internal Security Review

**2026-08-29 · pre-frontend · reviewer: the author**

A line-by-line adversarial read of every contract, checked against
[`ARCHITECTURE.md`](./ARCHITECTURE.md), with a proof-of-concept written for each suspicion before
any claim was made and a regression test left behind for each fix.

This is a self-review, not a third-party audit. It is worth exactly what that implies: it will not
have found the things I am blind to. It should not be read as clearance for mainnet.

## Scope

```
src/AarkaFactory.sol        src/AarkaSeries.sol       src/AarkaToken.sol
src/ExpiryCalendar.sol      src/AarkaLens.sol         src/libraries/DateLib.sol
src/hook/AarkaParityHook.sol
```

Testnet stand-ins in `src/testnet/` are out of scope; they never touch mainnet.

## Findings

| # | Severity | Issue | Status |
| --- | --- | --- | --- |
| 04 | **High** | Hook paid its arbitrage profit to any pool that triggered it, including pools it had never heard of | Fixed |
| 01–03 | **Medium** | `seriesFor` derived addresses from mutable state, breaking the resolver and allowing twin series | Fixed |
| 05 | **Medium** | An uninitialised sequencer uptime feed read as "sequencer healthy" | Fixed |
| 06 | Low | A future-dated sequencer round panicked on underflow instead of reverting cleanly | Fixed |
| 07 | Low | `_settleDebt` cast a delta it only assumed was negative | Fixed |
| 08 | Info | `AarkaLens` used raw `*` and `/` where settlement uses `Math.mulDiv` | Fixed |
| 09 | **Medium** | Hook price inversion divided by a truncated intermediate: panicked below `sqrtP = 2^48` and returned 26% wrong prices above it | Fixed |
| 11 | Info | `AarkaLens.allSeries()` is unbounded over an attacker-growable list | Documented |

---

### AUDIT-04 · High · Arbitrage profit could be stolen by any pool

`restoreParity(triggerKey)` donated the captured profit to the pool that triggered `afterSwap`,
and never checked that pool was one of its own.

**Uniswap v4 pools are permissionless, and any pool may name any hook.** So the attack was:

1. create a pool nobody else uses — `ROGUE/USDG` — naming Aarka's hook;
2. provide all of its liquidity;
3. break parity through the **underlying** pool, which carries no hook and so does not self-heal;
4. swap one dollar in the rogue pool.

`afterSwap` fires, the hook correctly arbitrages Aarka's real pools, and then pays the entire
proceeds into the attacker's pool, where they are the only LP.

Measured in `test_AUDIT04_attackerStealsTheArbitrageProfit`:

```
parity gap before the attack   2250 bps
parity gap after  the attack      4 bps   <- the hook did the work
fee growth into attacker pool  4.47e31    <- the attacker was paid for it
```

**Fix.** `wire()` records the three pool ids and `restoreParity` refuses any other:

```solidity
if (!isWiredPool[triggerKey.toId()]) revert UnknownPool();
```

**Verification.** The same PoC now shows the gap unchanged at 2250 bps, and the fee growth in the
attacker's pool measured against a control run with no dislocation available:

```
with a 2250 bps gap on the table   10208471007628153903901238
with no dislocation at all         10208471007628153903901238   <- identical
```

The attacker earns their own swap fee and not one wei more.

---

### AUDIT-01, 02, 03 · Medium · Address resolution derived from mutable state

`seriesFor` recomputed the CREATE2 address from `feedFor[underlying]` and `sequencerUptime` — both
of which governance can change. Three consequences, each with a PoC:

- **01.** After `setSequencerFeed`, `seriesFor` returned a different, empty address for a series
  that already existed. `ARCHITECTURE.md` advertises this resolver as the way to find a series with
  no subgraph, so every integrator using it would silently resolve nothing.
- **02.** The duplicate guard read the same broken resolver, so the same
  `(underlying, strike, expiry)` could be deployed twice.
- **03.** Via the asset registry instead: a repointed feed produced a twin with **byte-identical
  name and symbol** — `Aarka Floor NVDA 11SEP26 $215.00` — settling on a completely different
  oracle. A confusion attack with no forgery required.

**Fix.** The factory now records each deployment and treats the record as authoritative:

```solidity
mapping(bytes32 salt => address) public deployedSeries;
```

`seriesFor` returns the record when one exists and never moves again. `predictSeries` was split out
as the CREATE2 computation, documented as a prediction that legitimately moves with the registry.
The duplicate guard reads the record, so duplicates are now impossible by construction rather than
by address collision.

---

### AUDIT-05 · Medium · An uninitialised sequencer feed read as healthy

Chainlink's L2 pattern is `answer == 0` means up. A feed that has **never reported** returns
`(answer 0, startedAt 0)` — and `block.timestamp - 0` is enormous, so it cleared the grace period
too. A feed proving nothing about the sequencer sailed through the check proving the sequencer was
fine.

This mattered specifically because the sequencer feed address for Robinhood Chain is
[still unpublished](./ARCHITECTURE.md#15-open-items). The first address anyone wires in is the most
likely to be wrong, and the failure was silent.

**Fix.**

```solidity
if (startedAt == 0 || startedAt > block.timestamp) revert SequencerDown();
```

Refusing costs only the payoff split. `redeem` stays open regardless, so nothing is trapped.

---

### AUDIT-06, 07, 08 · Low and informational

- **06.** A future-dated `startedAt` underflowed, reverting with a panic rather than a named error.
  Same safe outcome, now diagnosable. Covered by the AUDIT-05 fix.
- **07.** `_settleDebt` computed `uint256(-d)` on a delta every call site happens to leave negative.
  A credit would have produced an enormous number and attempted to transfer it. Now asserted, so a
  future edit that reorders the calls fails loudly instead of quietly.
- **08.** `AarkaLens` used raw `*` and `/` where `AarkaSeries` uses `Math.mulDiv`. Bounded in
  practice, but a quote must never be able to disagree with the settlement it is quoting.

---

### AUDIT-09 · Medium · The hook mispriced cheap assets, then panicked on them

Second pass. `_priceX96` inverted a price by forming `p = sqrtP² / 2⁹⁶` and then computing
`2¹⁹² / p`. Both halves of that are wrong.

`p` **truncates to zero** for any `sqrtP` below `2⁴⁸`, and `MIN_SQRT_PRICE` is about `2³²`, so a
wide band of the legal range divides by zero. Just above the threshold `p` is a single-digit
integer, so the inverse is quantised into enormous steps — measured **26.5% error** at
`sqrtP = 548394833893341`.

This is not a corner nobody visits. **A deep out-of-the-money upside token trades near zero by
design**, which is exactly where the arithmetic falls apart. The consequences were a silently wrong
parity gap, a mis-sized solve, and eventually a panic that the `try/catch` swallowed — so the hook
would simply stop working, with no signal.

**Fix.** Divide twice instead of squaring first, so the degenerate intermediate never forms:

```solidity
uint256 half = FullMath.mulDiv(Q96, Q96, sqrtP);
return FullMath.mulDiv(half, Q96, sqrtP);
```

**Verification.** `testFuzz_safeFormNeverRevertsInRange` covers the full legal range at 10,000 runs.
`testFuzz_theInverseIsActuallyTheInverse` asserts a price and its inverse multiply back to `2¹⁹²`
to within a basis point. Hook behaviour is unchanged where it already worked — parity still closes
to 0 bps.

---

### AUDIT-11 · Info · The unbounded lens read

`allSeries()` loops the whole list at roughly **40k gas per series**, so it stops fitting a typical
`eth_call` past a thousand or so. Creation is permissionless, so anyone can grow that list.

Not a vulnerability: the lens is outside the protocol and holds nothing, `seriesPage` already exists
and is unaffected, and no core function iterates the list. Documented in the contract so a front end
does not reach for the wrong one.

---

## What was checked and found sound

**The conservation identity.** `floorPayoutPerUnit + upsidePayoutPerUnit == 1e18` holds by
construction: the upside leg is computed as `ONE - fp`, never independently, so the compiler
enforces it. `fp <= ONE` is provable in both branches — `S <= K` gives exactly `ONE`, `S > K` gives
strictly less.

**Solvency under adversarial ordering.** The worst possible outflow is pair-redemption, which pays
exactly 1 per pair, because claiming the two halves separately floors twice. Writing
`W = min(fs,us) + (fs-min)·fp + (us-min)·up`, the balance starts at `W` with equality and each
operation reduces the balance by no more than it reduces `W`, so `balance >= W` is preserved. Held
across **256,000 randomised calls** with zero failures.

**The escape hatch, tested directly.** `test_AUDIT07` corrupts the feed decimals, pauses the asset,
reports the sequencer down, and warps 400 days past an unsettleable expiry — then withdraws every
token. No admin, no timelock, no multisig. That is the property the no-admin design rests on and it
is now asserted rather than argued.

**Token burn authority.** `AarkaToken.burn` takes from an arbitrary holder with no allowance. Safe
only because `series` is immutable and every call site in the series burns from `msg.sender`. Both
call sites re-read and confirmed.

**Settlement round pinning.** The caller supplies a round; the contract proves it. The constraint
set — `updatedAt <= expiry`, within the 6-hour lookback, and no later round at or before expiry —
leaves essentially one valid round. The one gap is a Chainlink phase boundary, which is what the
challenge window exists for, and that window is convergent, monotone and time-bounded.

**`DateLib`.** Fuzzed across the entire `uint64` domain at 10,000 runs: never panics, always returns
exactly seven bytes. The month index is provably within its 13-entry array because `mp <= 11` for
any day-of-year. Separately checked that consecutive days advance by exactly one calendar day, which
is what would catch an off-by-one in the era arithmetic that spot checks miss, and that no month
ever yields an impossible day.

**Rounding dust.** Three wei deposited, settled at an unclean ratio: two wei out on the floor leg,
zero on the upside, one wei stranded in the vault, both supplies at zero. Dust accumulates and is
never claimable twice.

**Settlement is not a lever for the caller.** A hostile settler presented with a far better price
published ten minutes after expiry is refused, and the only round that qualifies is the correct one.

**Reentrancy.** `nonReentrant` on every state-changing entry point, checks-effects-interactions
throughout, and balance-delta accounting on deposit so the supply invariant survives a token that
misbehaves. The hook's transient flag makes its own re-entry a no-op rather than recursion.

## Accepted risks

Stated rather than hidden, because a review that lists no residual risk has not finished.

- **The hook stops arbitraging after expiry.** `series.mint` reverts once expired, so only the
  redeem direction remains and the pools drift one-sidedly. Correct behaviour; post-expiry pools
  should be retired.
- **The swapper pays for the arbitrage.** A swap that trips the threshold costs roughly 490k gas
  instead of 150k, and the profit goes to LPs. A real externality, cheap on an L2, and gated by
  `minDeviationBps` so ordinary swaps pay three storage reads.
- **Concentrated liquidity.** `_maxOut` estimates the reserve as if the position were full-range.
  For a tight position it overestimates, the exact-output leg reverts, and the arb aborts inside
  its `try/catch`. Safe, but the hook silently declines rather than sizing down.
- **Governance can register a hostile feed for *new* series.** Existing series are untouchable —
  the feed is immutable in bytecode. Front ends should surface `series.feed()` for confirmation.
- **A malicious underlying could report a false balance delta** and mint unbacked halves. Reaching
  that requires a compromised owner key, since assets are registered by governance. This is the
  trust boundary, and it is the only one.
- **Cold start.** Mint/redeem arbitrage fixes the sum from day one; the *split* has no anchor until
  someone trades it.

## Verification

```
136 unit, fuzz and invariant tests + 6 fork tests against Robinhood Chain mainnet
100% lines / statements / branches / functions on AarkaSeries, AarkaFactory,
     AarkaToken, ExpiryCalendar, DateLib
100% lines and functions on AarkaParityHook
256,000 randomised calls with every invariant holding
```

Every fix above ships with the PoC that found it, inverted into a regression test.
