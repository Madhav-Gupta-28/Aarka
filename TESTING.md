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

| | |
| --- | --- |
| AarkaFactory | `0xE47d91B64f4CcAf9943E6EE1F2b97053722BA0C0` |
| AarkaLens | `0xB3cAcd3770D0474d5aD8ba83D68A31C78E94adb2` |
| AarkaParityHook | `0x8524C561D2Ac10095775c6C2F6172a0DF8490040` (NVDA $210 · 30 OCT 26) |
| NVDA (stand-in) | `0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1` |
| TSLA (stand-in) | `0x06002571803D40bD20C13Bd835BE30a642623dEA` |
| USDG (stand-in) | `0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097` |

The NVDA and TSLA feeds mirror the real Robinhood Chain Chainlink feeds — same price, same
timestamp — through `script/mirror-feeds.sh`.

Live series, two strikes on each stock for three expiries:

| Series | 25 SEP 26 | 02 OCT 26 | 30 OCT 26 |
| --- | --- | --- | --- |
| NVDA $210 | `0x2349bEBe3D24fc86bAFcAED8fDFb4528EB9d6981` | `0x258D5559290e7C541Ff9f33dff249aF0a2B3E219` | `0xdB04d1652e2556b459cb57BB15fB1D95689c993b` |
| NVDA $230 | `0x09fBefDF2d0Cc3e32eBEA691a6324119a87Ef805` | `0x3f60Cd8a14E5eFf3029C11Fa32Db3CaFcC4AaE01` | `0x6E1Ac75F4B4abF4c56bf3aaD69aAdb6263833B2f` |
| TSLA $350 | `0x32c44090D2d82fE1eFbF8c997Ff4d3A435a26fc9` | `0xa068372F4467be213Cf6550f62E3186888824f8f` | `0x0aC9BC5012f830Ab2D53c147b06b9416E98C89f9` |
| TSLA $400 | `0x5a63Da1A0776Ff959bC5E04057dd3381077341ef` | `0xAa7CbdCe8ba7Cb2D3958E70106CcaB89c3204f27` | `0x1ec5Daf722D07D0B7F9Fcd0a956bEC957B852479` |

Settled, against the real Chainlink NVDA price at each close:

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

**5 — Try to break it.** Send some `uNVDA` to another address, then try to recombine. It refuses:
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
