# Deploying Aarka

## Robinhood Chain testnet (46630)

Testnet has **neither Robinhood stock tokens nor Chainlink feeds** — both mainnet addresses return
zero bytecode there. The deploy script therefore ships its own stand-ins (`src/testnet/`), which
reproduce the parts of the real contracts Aarka depends on, including the quirks:

- `TestStockToken` — 18 decimals, ERC-8056 `uiMultiplier` / `newUIMultiplier` / `effectiveAt`, plus
  Robinhood's `oraclePaused()`. It deliberately does **not** clear `effectiveAt` when an action is
  applied, because the real contract does not either.
- `TestAggregator` — 8 decimals, composite `(phaseId << 64) | round` ids, real round history, and
  `advancePhase()` so the phase-boundary path in settlement can be exercised.
- `NyseCalendar2026` — 52 expiries, Sep 2026 to Aug 2027, 16:00 America/New_York converted with the
  IANA database. Fridays, shifted to Thursday when the Friday is a market holiday.

Uniswap v4's PoolManager **is** on testnet, at the same address as mainnet
(`0x8366a39CC670B4001A1121B8F6A443A643e40951`), so the parity hook needs no stand-in.

### 1. Fund a deployer

```
https://faucet.testnet.chain.robinhood.com
```

The full deployment costs about **0.00038 ETH** (19.1M gas at 0.02 gwei), so one faucet claim is
more than enough.

> Use a wallet dedicated to deploying. Keep it separate from any wallet that receives prizes.

### 2. Simulate

```sh
forge script script/DeployTestnet.s.sol --rpc-url robinhood_testnet --sender <YOUR_ADDRESS>
```

### 3. Broadcast

```sh
forge script script/DeployTestnet.s.sol \
  --rpc-url robinhood_testnet \
  --broadcast \
  --private-key $PRIVATE_KEY
```

Or, preferably, with an encrypted keystore instead of a raw key:

```sh
cast wallet import aarka-deployer --interactive     # once
forge script script/DeployTestnet.s.sol \
  --rpc-url robinhood_testnet --broadcast --account aarka-deployer
```

### What it does

1. deploys `TestStockToken` (NVDA) and `TestAggregator` (RHNVDA / USD at $215)
2. deploys `ExpiryCalendar` and `AarkaFactory`
3. publishes every future expiry from `NyseCalendar2026`
4. registers NVDA against its feed
5. opens two series on the first expiry at least a week out — one at $215, one at $240
6. mints the deployer a working balance

Addresses are printed at the end and saved to `broadcast/DeployTestnet.s.sol/46630/`.

### Anyone can get tokens

`TestStockToken.claim()` mints 100 NVDA to the caller, once an hour, no permission needed. Nobody
has to ask for anything to try the protocol.

## Mainnet (4663)

Not yet. Blocked on the open items in [`ARCHITECTURE.md` §15](./ARCHITECTURE.md#15-open-items) —
principally the missing Chainlink sequencer uptime feed, without which the L2 outage guard cannot
run. `script/Deploy.s.sol` carries the verified mainnet token, feed and Uniswap v4 addresses.
