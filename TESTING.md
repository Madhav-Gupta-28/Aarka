# Testing Aarka on Robinhood Chain testnet

## Network

Add this to your wallet (MetaMask → Add network manually):

```
Network name    Robinhood Chain Testnet
RPC URL         https://rpc.testnet.chain.robinhood.com
Chain ID        46630
Currency        ETH
Explorer        https://explorer.testnet.chain.robinhood.com
```

## Contracts

Redeployed on 15 September 2026 with the settlement and symbol fixes from the second review.

| | |
| --- | --- |
| AarkaFactory | `0x69caa2b3d4f732861A36e78b5A3992d18faA9BcA` |
| AarkaLens | `0xaE4f737b0f259b1C8A15a73367670090c94bB2d7` |
| AarkaRouter | `0xe7C93E5b953a98F1601D469bFb30eE6f687c678a` |
| AarkaParityHook | `0x553f8d548b85b078152A6901fA19bEa19D8a0040` (NVDA $210 · 30 OCT 26) |
| AarkaSequencerFeed | `0x723e4FD23E26eFb48FEeFb2e45CE53627BCf2303` |
| NVDA (stand-in) | `0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1` |
| TSLA (stand-in) | `0x06002571803D40bD20C13Bd835BE30a642623dEA` |
| USDG (stand-in) | `0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097` |

The NVDA and TSLA feeds mirror the real Robinhood Chain Chainlink feeds — same price, same
timestamp — through `script/mirror-feeds.sh`, run every 30 minutes by CI.

Live series, two strikes on each stock for three expiries. Symbols carry the strike:
`fNVDA-210-30OCT26`.

| Series | 25 SEP 26 | 02 OCT 26 | 30 OCT 26 |
| --- | --- | --- | --- |
| NVDA $210 | `0xdFb1aCFAa87EAf10136242C3f273fE4CEA606Ac7` | `0xcE14497468dfcfBA0dfad442Af8561d2f956e4E7` | `0x7D31f372d747EDB24dB9242d5e48Cf68aA8dBdcF` |
| NVDA $230 | `0xBc25A8F80B30622aaCfeEfa054DC44125C1Cd9E7` | `0x81105a4a2d74cB353655469C815F55D392CEabb7` | `0x13b5eA7EEAFCfabeF731A97F4410E5Db941A4819` |
| TSLA $350 | `0x46A335B9611D6e542F7Dc6339097c90B7804881a` | `0xCC0DDe80Ce590e2092F00cf5b82016ffd17163F4` | `0xA34968Cdb62a753Aff8b3E172a931e1c76706E3e` |
| TSLA $400 | `0x2b51ed3125Cf98262B1C9BF075B81371315C29aF` | `0xcB18e35Ec23b9595ca8752d5FfEa09Cffd5e1a87` | `0x9F755706Bf8d5cdCe4BAe8e96E0d7B4942536F89` |

Every contract below is verified on the
[explorer](https://explorer.testnet.chain.robinhood.com), so each address opens to readable source.

Every series has a market: a Uniswap v4 pool for each half against USDG, and its own parity hook.
Each opened at a Black-Scholes split of its stock's pool price, at exactly 0 bps.

| Market | Parity hook |
| --- | --- |
| NVDA $210 · 25 SEP 26 | `0x533f1ee34100eFF09031D3d5DE802d290dBc0040` |
| NVDA $230 · 25 SEP 26 | `0x39aC5d768D0Dd32c1Fd133391308aC638A89c040` |
| TSLA $350 · 25 SEP 26 | `0x6de83EC68484355746F205B9A822785d7e714040` |
| TSLA $400 · 25 SEP 26 | `0xce07DfbeE7254c08E773dd7C04a7A7e444B54040` |
| NVDA $210 · 02 OCT 26 | `0x7fbd3d2aA2285cee5014bce41584F1A288C94040` |
| NVDA $230 · 02 OCT 26 | `0x794bb110Bfb78CEeF57d859FfC29103770478040` |
| TSLA $350 · 02 OCT 26 | `0x9b11f7704dAd01428d6D477623696b3821E00040` |
| TSLA $400 · 02 OCT 26 | `0x06a5881b0a358E779b1f9bA81b6d9d64bbea0040` |
| NVDA $210 · 30 OCT 26 | `0x553f8d548b85b078152A6901fA19bEa19D8a0040` |
| NVDA $230 · 30 OCT 26 | `0x086AA3fd893EE5CEcea6eBFaFd5b5dDaa5874040` |
| TSLA $350 · 30 OCT 26 | `0x578Ed50250440813887Db1723E8bb8d04F804040` |
| TSLA $400 · 30 OCT 26 | `0x3B14541fc6D434CA29a0f5575F0881d7974F0040` |

### Previous deployment

The first deployment (factory `0xE47d91B64f4CcAf9943E6EE1F2b97053722BA0C0`) is still on chain.
Three of its series ran their whole life and settled against the real Chainlink NVDA price at each
close:

| Series | Address | Close | Floor / upside |
| --- | --- | --- | --- |
| NVDA $215 · 04 SEP 26 | `0x0E676C09Cfd9065AF1f489534D9d6730a0fFF68c` | $230.2366 | 93.3822% / 6.6178% |
| NVDA $215 · 11 SEP 26 | `0x39F53AfDa432399EE7973015ED0C9d8a500a11c6` | $219.4800 | 97.9588% / 2.0412% |
| NVDA $240 · 11 SEP 26 | `0xb4943671814B39Eb221f9d794b2353a6c3978B51` | $219.4800 | 100% / 0% |

## Add the tokens to your wallet

Import these as custom tokens so balances show up. All 18 decimals except USDG, which is 6.

```
NVDA                    0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1   18
TSLA                    0x06002571803D40bD20C13Bd835BE30a642623dEA   18
USDG                    0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097    6
```

## The walkthrough

Start the site:

```sh
cd web && npm run dev      # http://localhost:3000
```

**1 — Connect.** If the wallet is on the wrong network the button says so; click it to switch.

**2 — Read the chart.** Hover across it. The ochre line is the floor: it tracks the stock up to
the strike then flattens. The white dashed line is the upside: nothing until the strike, everything after.
The readout underneath always says *one whole share* — that is the invariant the contracts enforce.

**3 — Split.** Enter `100`, press the button twice: once to approve, once to deposit. You get 100
`fNVDA` and 100 `uNVDA`. Check the balances row — your NVDA went down by 100 and both halves went
up by 100.

**4 — Recombine.** Switch to the Recombine tab, enter `40`, submit. You get 40 NVDA back and both
halves drop by 40. This works at any time, including after expiry and after settlement — which is
why the protocol needs no admin and no emergency exit.

**5 — Sell the upside for cash.** Open any series. In the *Sell upside* panel enter `10`,
approve once, then press *Keep the floor, sell the upside*. One transaction: your NVDA goes in, you
keep 10 `fNVDA-210-30OCT26`, and the upside is sold for USDG. The quote comes from simulating the
exact trade just before you sign, and the transaction reverts if the price moves more than 0.5%.

**6 — Buy the upside.** Press *Get 100,000 USDG*, then *Buy upside* with `500`. You pay USDG for
everything NVDA earns above $210 by expiry, with nothing to borrow and nothing to liquidate.

**7 — Break parity.** Scroll to *The two halves have to add up* and buy $50k of the floor. The swap
opens a gap against the stock, and the hook closes it before the transaction returns.

**8 — Try to break it.** Send some `uNVDA` to another address, then try to recombine. It refuses:
recombining needs one of each, and the panel caps you at the smaller balance.

## What is real and what is a stand-in

Real: the factory, the series, both half-tokens, the settlement logic, the parity hook, the lens.

Stand-ins: the NVDA and TSLA tokens and their price feeds. Robinhood Chain testnet carries neither —
the mainnet addresses return zero bytecode there. The tokens reproduce the real contracts' behaviour
including their quirks, such as not clearing `effectiveAt` after a corporate action lands.

The feeds are stand-in contracts but not stand-in prices. `script/mirror-feeds.sh` copies every
round from the real Robinhood Chain Chainlink feeds with its original timestamp, so the testnet
price is the market price, it goes quiet at the weekend the way the real feed does, and a series
settles against the real close.
