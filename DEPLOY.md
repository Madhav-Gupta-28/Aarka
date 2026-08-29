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

### Live testnet deployment

Deployed 2026-08-29, **redeployed after the security review** in [`AUDIT.md`](./AUDIT.md). The
earlier set carried the AUDIT-04 hook vulnerability and is abandoned; these are the live addresses.

| Contract | Address |
| --- | --- |
| `AarkaFactory` | `0xE47d91B64f4CcAf9943E6EE1F2b97053722BA0C0` |
| `AarkaLens` | `0x11d6e43CEBC46F5782Aa943924eAbDe8182A4317` |
| `ExpiryCalendar` | `0x111040a3CfA607EF19693A023b157e9f806C622b` |
| `AarkaParityHook` | `0x9aB510FBf4767eeA1F185Ef611BC717f7eb6c040` |
| `TestStockToken` (NVDA) | `0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1` |
| `TestAggregator` (RHNVDA/USD) | `0x6a985039287dC8BB054C36804eb75337f69f944F` |
| `TestUSDG` | `0xDF262DeFe539619576a789423c5145D0eDe8d32F` |
| liquidity router | `0x0722dE2fF7d0587a7809398c57EDea90515D71dF` |
| swap router | `0x83b5D54866A826426f4E413b668B587c052Ab824` |

Series: `$215 / 04SEP26` · `$215 / 11SEP26` `0x39F53AfDa432399EE7973015ED0C9d8a500a11c6` ·
`$240 / 11SEP26` `0xb4943671814B39Eb221f9d794b2353a6c3978B51`

52 expiries published, Sep 2026 to Aug 2027.

## Deploying the parity hook

The hook's permissions live in the low 14 bits of its own address, so the address must be mined.

> **The one thing that will cost you a night.** `HookMiner.find(deployer, ...)` must be given the
> **canonical Create2Deployer** `0x4e59b44847b379578588920cA78FbF26c0B4956C`, not `msg.sender`.
> Inside a Foundry test the CREATE2 is performed by the test contract itself, so mining against
> `address(this)` works and the mistake stays invisible. In a broadcast script Foundry routes
> `new X{salt: ...}` through that factory instead, the mined address no longer matches, and the
> hook's constructor rejects it with `InvalidHookAddress()`. Which is the constructor doing its
> job — but only if you know what it is telling you.

```sh
forge script script/DeployHook.s.sol --rpc-url robinhood_testnet --broadcast \
  --private-key $PRIVATE_KEY --gas-limit 900000000 \
  --sig "run(address,address)" <SERIES> <STOCK_TOKEN>
```

Deploys `TestUSDG`, mines and deploys the hook, opens the three pools at parity, wires them, and
seeds liquidity. The `--gas-limit` matters: `HookMiner` searches up to 160k salts and will exhaust
the default script frame.

### Proving it works

```sh
forge script script/ProveParity.s.sol --rpc-url robinhood_testnet --broadcast \
  --private-key $PRIVATE_KEY --gas-limit 900000000 \
  --sig "run(address,address,address,uint256)" <HOOK> <SWAP_ROUTER> <STOCK_TOKEN> 50000000000
```

A real run against the reviewed contracts:

```
                      before        after
P(underlying)        $215.000      $222.255
P(floor)             $180.000      $187.733
P(upside)             $35.000       $34.541
sum of halves        $215.000      $222.274
parity gap              0 bps         0 bps

ParityRestored: minted 112.24 NVDA, 616.66 USDG profit donated to LPs
```

A $50,000 swap moved the floor pool from $180.00 to $187.73. Left alone that would have opened a
gap of roughly 360 bps. The hook bought the underlying, minted, and sold both halves inside the
same transaction — and the sum still tracks the underlying to within a basis point.

## Mainnet (4663)

Not yet. Blocked on the open items in [`ARCHITECTURE.md` §15](./ARCHITECTURE.md#15-open-items) —
principally the missing Chainlink sequencer uptime feed, without which the L2 outage guard cannot
run. `script/Deploy.s.sol` carries the verified mainnet token, feed and Uniswap v4 addresses.
