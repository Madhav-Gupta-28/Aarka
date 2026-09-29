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
| 15 | **Medium** | A future-dated feed round made the factory's freshness check underflow and panic, blocking all series creation | Fixed |

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

### AUDIT-15 · Medium · A future-dated price panicked series creation

Found on the live testnet deployment, not in review. `_requireStrikeInBand` computed

```solidity
if (block.timestamp - updatedAt > BAND_MAX_STALENESS) revert SpotUnavailable();
```

If a feed reports a timestamp **ahead** of the current block, that subtraction underflows and
panics with `0x11` instead of reverting with a name. Every call to `createSeries` on that asset
fails, and the panic says nothing about why.

This is the same defect as [AUDIT-06](#audit-06-07-08--low-and-informational), which was fixed for
the sequencer feed and **missed here**. Two places read a timestamp and subtract it; only one was
hardened. That is the ordinary way a fix half-lands.

**Fix.**

```solidity
if (updatedAt > block.timestamp) revert SpotUnavailable();
```

A feed reporting a future timestamp is telling you something is wrong with the feed. Treat it as
unusable rather than letting the subtraction decide.

**How it surfaced.** A settlement round was published on testnet with a deliberately future
`updatedAt`, and creating a new series began panicking. Worth stating plainly: this was found by
someone clicking around a deployment, not by the 148 tests or the line-by-line review — which is
the argument for putting a thing in front of people early.

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

**The escape hatch, tested directly** — for holders of both halves; see AUDIT-16 for everyone else. `test_AUDIT07` corrupts the feed decimals, pauses the asset,
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

---

# Second review — 15 September 2026

Everything re-read line by line after the frontend, the testnet refresh and the feed mirror landed:
contracts, hook, lenses, scripts and every component in `web/`. Claims were checked against the
chain and the compiler rather than against this document, and two attacks were measured with
proof-of-concept tests before anything was written about them.

| # | Severity | Issue | Status |
| --- | --- | --- | --- |
| 16 | **High** | A series with no feed round in the six hours before expiry can never settle, and a holder of only one half then has no way out | Fixed and redeployed |
| 17 | **Medium** | Token symbols do not include the strike, so two series on the same expiry share a symbol | Fixed and redeployed |
| 18 | **Medium** | Wallet writes on the site were not pinned to Robinhood Chain | Fixed |
| 19 | Low | The site reads `allSeries`, which the lens itself says not to use past a small deployment | Fixed |
| 20 | Low | The feed mirror would run with the key that owns the factory, calendar and both feeds | Fixed |
| 21 | Low | The "max" button broke on any balance of 1,000 or more | Fixed |
| 22 | Low | The README and this document overstated test coverage and the escape hatch | Fixed |
| 23 | Low | The hook's 30 bps threshold sat below the ~90 bps its three pool fees cost, so it spent gas on arbs that could never clear | Fixed by parameter |
| 24 | Low | An arb sized off the curve alone could ask for more tokens than the PoolManager physically holds, so the hook silently did nothing on the largest swaps | Fixed and redeployed |
| — | Info | Two economic attacks on the hook were measured and neither pays | Recorded in `test/hook/EconomicAudit.t.sol` |

---

### AUDIT-16 · High · A quiet close makes a series unsettleable, and one-leg holders are stranded

`settle` accepts only a round published within `MAX_SETTLEMENT_LOOKBACK = 6 hours` before expiry,
and no later round can ever satisfy "at or before expiry" once the clock has passed it. So if the
feed publishes nothing in that window, the series is **permanently** unsettleable.

That was treated as safe because `redeem` is never disabled (see the AUDIT-07 escape hatch above).
It is safe **only for someone holding both halves**. The product exists so that people hold one:
the whole flow is "split, then sell the half you don't want". A holder of the floor alone, or the
upside alone, has nothing to redeem against and no claim to make. Their tokens are worth nothing
until the other half can be found, and nothing obliges anyone to sell it back.

The window is not a theoretical miss. Robinhood Chain's equity feeds publish on a **0.5% deviation
or a 24-hour heartbeat**, so a calm session produces no rounds at all. Read from mainnet:

```
SPY / USD   round 126   Fri 11 Sep 12:56 UTC   $765.26
            (close)     Fri 11 Sep 20:00 UTC   ← 7.1 hours after the last round
SPY / USD   round 127   Mon 14 Sep 00:00 UTC   $760.04
```

A SPY series expiring 11 September 2026 could never have been settled. The same week NVDA's last
round before the close was 3.7 hours old, inside the window with little to spare, and SPY's feed has
published 129 rounds since launch against NVDA's 1,037. The original lookback was derived from one
ticker on an earnings week; open item 7 in `ARCHITECTURE.md` said to re-measure on a calm week and a
low-volatility name, and this is what that measurement shows.

**Why the fix is not "widen the window".** The deviation threshold means an older round is still
within 0.5% of the market until the next one is published, so a longer lookback — the heartbeat plus
a margin — is defensible for accuracy. But the 6-hour bound also detects a corporate-action pause,
because a paused feed stops publishing. Widening it removes that signal.

**Recommended.** Separate the two jobs. Accept the last round at or before expiry up to the
heartbeat, check `oraclePaused()` and the ERC-8056 multiplier at settlement time for the pause
case, and add a last-resort path: if a series is still unsettled some days after expiry, allow
settlement against the first round published *after* expiry. A slightly late price is far better
than no price for someone holding one half.

**Fixed.** `MAX_SETTLEMENT_AGE` is 26 hours: the 24-hour heartbeat plus two hours of margin.
`oraclePaused()` is still checked at settlement, and a new check refuses the normal path when an
ERC-8056 action took effect after the settlement round and at or before expiry. After
`LATE_SETTLEMENT_DELAY` (7 days) only the round pinning and the feed's 8 decimals still apply, and
the series records `settledLate`. Every series now resolves. Tests: `test/QuietClose.t.sol`, and
`test_AUDIT16_theRealSpyCloseOnElevenSeptemberSettles` in `test/Fork.t.sol`, which settles the real
SPY round on a mainnet fork. Shipped in a new factory; the old series are untouched.

---

### AUDIT-17 · Medium · Symbols do not distinguish strikes

`fNVDA-30OCT26` is the symbol of **both** the $210 and the $230 floor tokens on testnet today,
read back from the lens. The strike is in `name()` by design (`ARCHITECTURE.md` §5.2), but wallets
and most DEX token lists show the symbol. A buyer choosing between two tokens that look identical
can pick the wrong strike, and anyone can create a same-expiry series to sit next to a popular one.

Separately, `name()` renders the strike to the cent, so two strikes differing by less than a cent
produce byte-identical names **and** symbols.

**Fixed.** Symbols are now `fNVDA-210-30OCT26`, or `fNVDA-212.50-30OCT26` for a strike with cents,
and `createSeries` refuses a strike that is not a whole number of cents. Same release as AUDIT-16.

---

### AUDIT-18 · Medium · Wallet writes were not pinned to the chain

Every `writeContract` on the site — approve, deposit, recombine, settle, claim, faucet and both
parity swaps — was sent to whichever chain the wallet happened to be on. The header offers a
"switch network" button, but nothing stopped a connected wallet on another network from signing an
unlimited `approve` to an address that means something else there.

**Fix.** Every write now passes `chainId: robinhoodTestnet.id`, so wagmi refuses to send it to any
other chain.

---

### AUDIT-19 · Low · The site ignores the lens's own advice

`AarkaLens.allSeries` is documented as unsuitable past a small deployment, and series creation is
permissionless, so anyone can grow the list until the page's single read no longer fits an
`eth_call`. The site calls exactly that function, and `positionsOf` has the same shape. At 15
series this is nowhere near the limit. It becomes a one-transaction-per-series way to take the page
down on mainnet.

**Fixed.** The lens gained `positionsPage`, and the site reads series and positions 25 at a time.
Settled series with nothing left to claim drop off the board.

---

### AUDIT-20 · Low · One key would own everything the mirror touches

`script/mirror-feeds.sh` needs a key that owns the two testnet feeds. The obvious one is the
deployer, which also owns the factory, the calendar and the hook. Putting it in a CI secret widens
the blast radius of that secret to the whole testnet deployment: a leak could publish any price and
settle any series against it.

**Fixed.** Both feeds were transferred to a new key that owns nothing else, and only that key is
stored as the `TESTNET_FEED_KEY` CI secret. The first scheduled run read both mainnet feeds with it.

---

### AUDIT-21 · Low · "max" broke on large balances

The button filled the amount with a locale-formatted number, so a balance of 1,000 became the
string `1,000`, which `parseUnits` rejects, leaving the deposit button dead. It also rounded to four
decimals and could round **up** past the balance. Now uses `formatUnits` — exact, no separators.

---

### AUDIT-22 · Low · Overstated claims

The README said "100% line and function coverage on `src/`". Measured: 100% on the five core
contracts, 100% lines and 73% branches on the hook, 96% on `AarkaLens`, and **0% on `HookLens`**,
which the parity panel depends on and which has no tests. The README also said that if the oracle
dies "nothing is stranded", which AUDIT-16 shows is true only for pair holders. Both corrected.
Separately, `AarkaLens`'s header said every external read is wrapped; the series reads and the
underlying's `balanceOf` are not.

---

### Measured and refuted

**Manipulating the stock pool through the hook.** The hook treats the unhooked NVDA/USDG pool as the
reference, so moving that pool drags both halves after it — confirmed: a 500 NVDA sale moved the
stock pool 13%, and one dollar traded in the floor pool pulled the floor 6.9% and the upside 3.1%.
The question is whether that pays. It does not. Round-tripping the stock pool through the hook cost
the manipulator **−76,206 USDG against −2,288** for the identical round trip without triggering it,
because the hook's arbitrage is taken out of the manipulator's own dislocation. Now a regression
test.

**Just-in-time liquidity taking the donation.** The hook donates to whoever is in range in the
triggering pool at that moment. Across three position sizes and ranges, the JIT position lost more
to the flow it absorbed than it earned from the donation (−24 to −1,686 USDG). Not ruled out against
mostly uninformed flow, so donating to the trigger pool is still worth revisiting.

---

### AUDIT-23 · Low · The hook tried arbs it could never profit from

Found while proving the redeployed hook through the router. A 1,500 share sale opened a 64 bps gap,
above the 30 bps `minDeviationBps`, so the hook ran its solver and swaps. Closing that gap costs a
0.3% fee in each of three pools, about 90 bps, so the profit check failed and the arb reverted
inside its `try/catch`. Correctly, but after spending roughly 285,000 gas of the trader's.

**Fixed by parameter.** `setParams(100, 100_000e18)` on the live hook. A 4,000 share sale then
opened a wider gap, and the hook redeemed 52.76 NVDA of halves, paid 41.74 USDG to LPs and closed it
to 0 bps. The threshold belongs above the combined fee of the three pools it trades.

### AUDIT-24 · Low · The hook went quiet on the swap that needed it most

Found on 22 September during manual end-to-end testing, by running the parity demo with a
deliberately oversized sell: 198,652 floor tokens into a pool holding about $1.4m
([tx `0x205211aa`](https://explorer.testnet.chain.robinhood.com/tx/0x205211aa40f75f5909eb4825df793f37e93970b665f0b3b4ba943546cb7a8817),
block 122,649,574). The swap succeeded. The hook emitted nothing. The flagship market was left
**9,555 bps out of parity**.

Uniswap v4 settles a swap's input currency only *after* `afterSwap` returns, so while the hook runs,
the tokens being sold are still an outstanding debt — the PoolManager does not hold them yet. The
arb's legs end in a real `take`, which moves real tokens out of the PoolManager's real balance.
`_solveSize` capped itself against the *curve* — half of what the position virtually holds — and
asked to take 16,475 floor tokens from a PoolManager holding 7,014. The ERC20 reverted, the
`try/catch` in `afterSwap` swallowed it, and the trade went through untouched.

The shape of the failure is backwards: a larger swap opens a larger gap, which draws a larger arb,
which is likelier to outrun the balance. The hook falls silent as the reason to act grows.

**Fixed** by intersecting `_maxOut` with the PoolManager's actual balance of the currency the arb
must take, so the trade is sized against what is really there rather than what the curve implies.

**What the fix does not do, stated plainly.** Replayed against the same block and the same trade, it
moves the residue from 9,555 bps to 9,095. It does not repair the pool — repairing it means buying
an equal quantity of the *upside* half, and that pool is far too shallow to absorb it. That residue
is a liquidity-depth limit, not a hook defect: no arbitrageur, in that transaction or after it,
could have done better.

**Why low.** Nothing is lost when it fires — the hook holds no inventory, the user's trade is
untouched, and the vault's 1:1 identity is unaffected, so the arb remains open to anyone. And it
takes a single trade that moves a pool by orders of magnitude: at the depth these pools carry, an
ordinary swap draws an arb of tens of tokens against a balance of thousands. Every trade in the
manual test run — split, sell upside, buy upside, sell floor, recombine, and a $50k parity demo that
made the hook mint 206.07 NVDA and pay 1,180.71 USDG to LPs — behaved exactly as quoted.

Two fork tests pin it: one replays the block and asserts the deployed hook did nothing, the other
etches the fixed hook at the same mined address and asserts it acts.

**Redeployed the same day.** Fifteen new hooks, one per series — the three 06 NOV series had no
market before and have one now — each opened at 0 bps against a stock pool realigned to the mirrored
Chainlink price. Every hook's runtime code matches the 0.8.33 build byte for byte once immutables
are masked, and all fifteen are verified on the explorer. Replaying the same 198,652-token dump
against the live deployment leaves 5,173 bps where the old hook left 9,555: the hook now acts at the
size the balance allows, and the rest is the depth limit described above. The twelve previous hooks
remain on chain and still work; nothing reads them.

---

---

### Also added in response to this review

**`AarkaRouter`.** The site called Uniswap's `PoolSwapTest`, a test contract, and nothing let a user
do what the headline says. The router splits and sells one half in a single transaction, or buys a
half with cash, with a caller-set minimum output. It holds nothing between calls, pulls only from
`msg.sender`, accepts only factory-created series, and its unlock callback is reachable only from
the PoolManager. Eleven tests, including that the parity hook still reacts to trades made through
it. Checked on chain: 10 NVDA in, floor kept, 133.21 USDG out, router holding zero afterwards.

**`HookLens` tests**, closing the 0% coverage gap from AUDIT-22.

## Verification, 15 September

```
178 unit, fuzz and invariant tests + 7 fork tests against Robinhood Chain mainnet, all passing
coverage: 99.3% lines, 97.6% statements, 85.8% branches, 98.9% functions across src/
forge lint: 0 errors; typecast warnings each guarded by a preceding check
no private key in git history; .env never committed
```

---

### Open item 1, closed as far as it can be — the sequencer guard now runs

Robinhood Chain is an Arbitrum Orbit L2 and its own documentation tells integrators to check a
Chainlink sequencer uptime feed before trusting a price. Chainlink publishes no such feed for this
chain. Re-checked on 22 September 2026: **57 feeds, 33 of them equities, no uptime feed.** X Layer
has one. Robinhood Chain does not.

So the guard has shipped disabled since the first deployment, with every series emitting
`SequencerCheckDisabled` to say so. `AarkaSequencerFeed` fills the gap: Chainlink's exact interface
and semantics, written by the same keeper that mirrors the prices, wired in through
`setSequencerFeed`. Three series created after it — NVDA $210 and $230 and TSLA $350, all 06 NOV 26
— carry it. The twelve older ones keep the zero address, because a series' feeds are immutable.

**Why a single keeper is acceptable here, stated rather than assumed.** A hostile or broken
reporter has two moves, and neither is dangerous:

| | |
| --- | --- |
| Reports **down** while the chain is up | Settlement reverts — until `LATE_SETTLEMENT_DELAY`, which ignores the sequencer entirely. A week's delay, never stranded funds |
| Reports **up** while the chain is down | Exactly the status quo, where no feed is wired at all |

It can make settlement stricter or leave it unchanged. It cannot make it looser than today. That
argument only holds because AUDIT-16 added the late path; before that fix, a stuck reporter would
have been able to block settlement permanently, and shipping this would have been a bad trade.

**It fails closed.** `latestRoundData` reports down once the last report is older than
`MAX_REPORT_AGE` (100 minutes, against a 30-minute keeper). A keeper that dies, loses its key or
cannot reach the chain stops vouching for it rather than silently continuing to.

12 tests cover the feed and what it does to settlement: up, down, a restart holding settlement for
the grace period, a dead keeper reading as down, and the late path overriding all of it.

---

## Third review, 29 September

An automated review with the [Pashov `solidity-auditor`](https://github.com/pashov/skills) skill:
twelve specialised agents per pass, two passes over `src/` and `script/` at `5e426f3`, every
finding put through the skill's four gates by hand. Three findings survived; all three are fixed
below. Nineteen leads were recorded as well; the ones that were cheap and safe to close are closed,
the rest are listed at the end.

Numbered from 25: AUDIT-24, found in manual end-to-end testing on 22 September, is recorded
with the second review above.

None of this changes a deployed contract. Nothing here is upgradeable, so the testnet deployment
keeps the old code until it is redeployed; the X Layer adapter has not been deployed at all.
The hook half of it shipped on 29 September, when the eleven open markets were redeployed (see
the fourth review); the sequencer feed and the router still run the older code.

### AUDIT-25 · High · A submitter could choose the settlement price on Data Streams

`StreamsAggregator.submit` records any signed report newer than the last one on file, and it
never read the report's own `validFromTimestamp` or `expiresAt`. Recording is permissionless and
ordered by observation time, so whoever records decides the history:

1. hold back a favourable signed price from inside the 26-hour window before expiry;
2. record it once nothing newer is on file;
3. record any report from after expiry — now the true last price before expiry can never be
   added, because it is older than the latest round;
4. settle. `_requireNoLaterRound` passes, and no challenge is possible, because no later
   pre-expiry round can ever be recorded.

**Fix.** `submit` enforces the report's validity window and a `MAX_SUBMIT_DELAY` of ten minutes
between observation and recording. A held-back price is now too old to record long before it is
useful. What remains is the ordinary race at the close — a submitter can still pick among prices
from the last ten minutes — which a keeper recording every poll closes in practice.
`test_aHeldBackPriceCannotBecomeTheSettlement` runs the attack and watches it fail.

### AUDIT-26 · Medium · A keeper that resumed after a gap skipped the grace period

`AarkaSequencerFeed.report` refreshed the current round whenever the status was unchanged. But
once `MAX_REPORT_AGE` passes, `latestRoundData` has been telling every reader "down" — and that
synthetic down was never written to storage. So the first "up" after the gap refreshed the old
round, carried its `startedAt` forward, and `_requireSequencerUp` saw a sequencer up for days. The
one-hour grace period, which exists for exactly the moment a watched chain comes back, was skipped.

This also corrects a claim above: an honest keeper with an outage *could* make settlement looser
than intended, not only stricter.

**Fix.** A report that arrives after the round has gone stale opens a new round, dated now,
whatever it says. `test_aReportAfterAGapRestartsTheGracePeriod` covers it.
`test_settlementWorksWhileTheSequencerIsUp` had been passing on the bug — it reported twice, four
days apart, while its comment said "every half hour". It now reports every half hour.

### AUDIT-27 · Medium · Just-in-time liquidity could leave with the arbitrage donation

The hook donates the whole arbitrage profit to the in-range liquidity of the pool that triggered
it, and nothing gated liquidity. ECON-03 had measured the round trip as unprofitable at the sizes
tried, against informed flow, and left it open. The round trip itself — add, trigger with a dust
swap, remove, in one transaction — was never closed, and the underlying pool carries no hook, so
a gap opened there waits for whoever triggers first.

**Fix.** The hook now also takes `afterAddLiquidity` and `beforeRemoveLiquidity`, and liquidity in
a hooked pool cannot be withdrawn — nor its fees collected — until `MIN_LIQUIDITY_AGE`, one hour,
after it was last added. A sniper has to stand in the pool for an hour of real exposure. The
permission bits are now `0x640`, so the hook address is mined against three flags; the constructor
asserts it. ECON-03 now asserts the round trip reverts, and succeeds after the hold.

A donation can still reach liquidity that has only been there for an hour; that is the trade-off,
and the one every donating v4 hook makes. Honest LPs cannot withdraw within an hour of adding.

### Also changed in response to this review

- `wire` requires the two halves' pools to name this hook, and all three pools to be initialised.
  Either mistake used to leave a hook that silently never acted, or divided by a zero price.
- `AarkaRouter.unlockCallback` asserts the sign of both swap deltas before negating, as the hook's
  own settlement already did.

### Leads left open, with the reason

| Lead | Why it stays open |
| --- | --- |
| `challengeSettlement` skips `settle`'s sequencer, pause and corporate-action checks | A later round inherits the corporate-action result by construction, and no bad price was found without AUDIT-25, now closed |
| `_requireNoLaterRound` probes only `roundId + 1` | Holds for Chainlink rounds within a phase; the phase boundary is what `challengeSettlement` is for |
| Mint and redeem stay open through a corporate action | §3.6: stock tokens do not rebase. Three agents argued otherwise; worth confirming against the live token before mainnet |
| `registerAsset` can be front-run by `createSeries` | Owner action; a series opened on a retiring feed is visible and avoidable |
| Router accepts any pool containing the sold half | Only the caller's own funds are at risk; an integrator calling it for a user should pin the pool |

---

## Fourth review, 29 September

A final end-to-end pass: every contract line, the router, the scripts and keeper, and the site's
integration layer, read against the deployed testnet state and each other. One contract finding,
two integration findings, and two site defects; all fixed. The rest were checked and found sound.

### AUDIT-28 · Low · A partial arb fill could revert the trader's swap

The redeem arb buys each half with an exact-output swap and then `take`s the full size. `take`
draws on the PoolManager's balance of the whole currency, not the pool's, so when the hooked pool's
reachable liquidity runs out first, the take still succeeds and the hook is left owing the
difference. `_profit` read only the quote currency, which the unpaid halves made look better, so the
arb returned normally and the debt surfaced as `CurrencyNotSettled` at the end of the trader's
unlock — outside the try/catch. The trader's own swap reverted.

It needs concentrated liquidity in the hooked pool and more of the half in the PoolManager than that
pool can reach; the second is free to arrange, by sending tokens to the PoolManager or holding them in
any other pool. The testnet pools are all full range, where the `reserve / 2` cap makes an
exact-output leg always fill, so nothing deployed was exposed. On a mainnet market with ordinary
concentrated LPs it would have been a way to block trading.

**Fix.** `restoreParity` requires the hook's delta in all four currencies to be zero before it
returns, so a partial fill reverts inside the try/catch and the trade goes through untouched.
`test_AUDIT28_aPartialFillNeverRevertsTheTradersSwap` reproduces it, and failed before the fix.

### AUDIT-29 · Medium · The keeper runs every few hours, not every thirty minutes

GitHub runs scheduled workflows on a best-effort basis. Over the last forty runs of
`mirror-feeds.yml` the gap was never under 128 minutes, with a median of four hours, against a
thirty-minute schedule. Two things follow.

- **The mirror dropped rounds.** It copied only the newest mainnet round each run. The equity feeds
  publish on every 0.5% move and trade overnight, so at an expiry the last pre-close round was
  routinely overwritten by an overnight one before the keeper ran, and a testnet series would have
  settled on a price hours older than the close. `mirror-feeds.sh` now walks back to the last
  mirrored round and pushes every one it missed, oldest first. Measured on 29 September: 26 NVDA
  rounds in the preceding 48 hours, where the old script would have copied a handful.
- **The sequencer feed reads down most of the time.** It fails closed after `MAX_REPORT_AGE`, 100
  minutes, so with a four-hour keeper the three 06 NOV series that carry it can only settle through
  the normal path in the window after each run. Funds are never at risk — the late path opens a
  week after expiry — but the fix is operational: run the keeper somewhere that keeps time,
  `LOOP=1800 ./script/mirror-feeds.sh` on any always-on host. The twelve older series carry no
  sequencer feed and are unaffected.

### Site

- **Every refused transaction was reported as "not enough ETH".** Any revert caught while the
  wallet estimated gas carries the word "gas" in its message, and the error text matched on it.
  Every call is now simulated before the wallet opens, the ABIs carry the contracts' custom errors,
  and each refusal is explained by name — `SequencerDown`, `ClaimsLocked`, `FaucetCooldown` and the
  rest — with no fee paid and no wallet prompt for a call the chain would refuse.
- **Strikes were rounded to the dollar in labels.** The factory accepts any whole-cent strike, so a
  $212.50 split would have been labelled $213 across the site. Labels now print the strike as written.

### Redeployed

The eleven open markets got new hooks on 29 September carrying AUDIT-27 and AUDIT-28, mined for
permission bits `0x640` and opened at their old markets' prices at 0 bps. All eleven verify on the
explorer against the current source. A $50k parity trade was rehearsed on a fork first and a real
$5 trade run through the router afterwards. Deploying them showed that forge's exact gas estimates
can fall short on this chain, whose L1 data fee moves between simulation and inclusion, so
`open-markets.py` now asks for twice the estimate.

### Checked and sound

Solvency and the payout identity (5 invariants, 2.25 million random calls); settlement's round
pinning, lookback, late path and challenge; claims rounding down; token mint and burn reachable only
from the series; the factory's feed registry reaching no existing series; the router pulling only
from `msg.sender`, returning unsold halves and holding nothing between calls; the hook's reentrancy
flag, self-call isolation, sign-checked settlement and wired-pool check; no key in any commit.

Stated rather than fixed, because they are properties of the testnet stand-ins: the testnet feeds
and the sequencer feed are single-key contracts, so the keeper key can publish any price, backdated,
and settle a testnet series with it. On mainnet the feeds are Chainlink's.

```
213 unit, fuzz and invariant tests, all passing
7 fork tests against Robinhood Chain mainnet, 3 against X Layer, 2 against the testnet, all passing
```
