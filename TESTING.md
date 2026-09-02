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
| AarkaParityHook | `0x309E90054c22b601D0393811e4b31FEaCC7A4040` |
| NVDA (stand-in) | `0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1` |
| USDG (stand-in) | `0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097` |

Series:

| Strike / expiry | Address |
| --- | --- |
| $215 · 04 SEP 26 | `0x0E676C09Cfd9065AF1f489534D9d6730a0fFF68c` |
| $215 · 11 SEP 26 | `0x39F53AfDa432399EE7973015ED0C9d8a500a11c6` |
| $240 · 11 SEP 26 | `0xb4943671814B39Eb221f9d794b2353a6c3978B51` |

## Add the tokens to your wallet

Import these as custom tokens so balances show up. All 18 decimals except USDG, which is 6.

```
NVDA                    0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1   18
USDG                    0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097    6
fNVDA-11SEP26 (floor)   0x5AF106B70B3F975FD771689c5aF31115Cf99Fc0A   18
uNVDA-11SEP26 (upside)  0xA86e760f5D3319d746f52EC9c14e684B9cFa3891   18
```

## The walkthrough

Start the site:

```sh
cd web && npm run dev      # http://localhost:3000
```

**1 — Connect.** If the wallet is on the wrong network the button says so; click it to switch.

**2 — Read the chart.** Hover across it. The ochre line is the floor: it tracks the stock up to
$215 then flattens. The white dashed line is the upside: nothing until $215, everything after.
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

Stand-ins: the NVDA token and the price feed. Robinhood Chain testnet carries neither — both
mainnet addresses return zero bytecode there. The stand-ins reproduce the real contracts' behaviour
including their quirks, such as not clearing `effectiveAt` after a corporate action lands.
