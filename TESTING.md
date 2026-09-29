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
| AarkaParityHook | `0xFd7Ac12730eFAE6e0B4e7e5Beb29780989D04040` (NVDA $210 · 30 OCT 26) |
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

All fifteen series have a market: a Uniswap v4 pool for each half against USDG, and its own parity
hook. Every one opened at a Black-Scholes split of its stock's pool price, at exactly 0 bps.

The hooks were redeployed on 22 September with the AUDIT-24 sizing fix, and the two stock pools
realigned to the mirrored Chainlink price at the same time — NVDA $227.31, TSLA $376.12.

The eleven open markets were redeployed again on 29 September with the AUDIT-27 liquidity hold and
the AUDIT-28 settlement check, each opened at its old market's prices so nothing a user sees moved.
Their addresses end in `0640`, the three permission bits the hook now needs. The four 25 SEP 26
series had ended by then and keep their 22 September hooks. Every replaced hook is still on chain
and still works; the site reads them only for the parity history.

| Market | Parity hook |
| --- | --- |
| NVDA $210 · 25 SEP 26 | `0x4A5AFd38edB9B00F8e668c9Ca8270f4696fbC040` |
| NVDA $230 · 25 SEP 26 | `0x4ED10b89A0c37efDA6d8473A4CB2c81836aB0040` |
| TSLA $350 · 25 SEP 26 | `0xc1c6720e95E70B51Bbb605101273216DEf7a4040` |
| TSLA $400 · 25 SEP 26 | `0x029E9Fa2ef97c2D56A1DA76eCD089807af2DC040` |
| NVDA $210 · 02 OCT 26 | `0x78976b4F38e66dFF82bE1C3B35E37ee8428f8640` |
| NVDA $230 · 02 OCT 26 | `0xc84Dd6ec3f2BC560dAa06648999FE3c39110c640` |
| TSLA $350 · 02 OCT 26 | `0xe38d9f109E62bf11A438869C5f82d79788940640` |
| TSLA $400 · 02 OCT 26 | `0xcE497F09B3ada431e954cb2b39f9b7684fd18640` |
| NVDA $210 · 30 OCT 26 | `0x8870eAd4E4147cE352F1B33943543031a7c80640` |
| NVDA $230 · 30 OCT 26 | `0x6d316696b4c80f71ec66F43Cd8F801D638158640` |
| TSLA $350 · 30 OCT 26 | `0xd41CCb4C5E91b89034e75A44712b5c92B9750640` |
| TSLA $400 · 30 OCT 26 | `0xc117478b0b0689E1295E832E72C98cf911e8C640` |
| NVDA $210 · 06 NOV 26 | `0x7dd74c60E65138103891cB1E557c31E65b1B0640` |
| NVDA $230 · 06 NOV 26 | `0xBba9E3124A2511e2Cf501Eb51CEDCf28496A4640` |
| TSLA $350 · 06 NOV 26 | `0x68D08E3B92497F78D2016b0003266dEd33338640` |

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
