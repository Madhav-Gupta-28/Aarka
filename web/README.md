# Aarka — web

Next.js 15 + wagmi + viem, reading Robinhood Chain testnet directly. No backend and no indexer:
series and positions come from `AarkaLens`, a page at a time.

```sh
npm install
npm run dev          # http://localhost:3000
```

Addresses live in `lib/contracts.ts` and point at the deployed testnet set.

## Structure

The design is "The Tablet of Shamash" from the Claude Design handoff in `../project-setup-questions/`:
Bloomberg-terminal numbers, carved-stone surfaces, a brutalist grid, and pixel relics drawn from code.

```
app/page.tsx                      home: hero, how it works, What if?, three ways, built to be fair
app/markets/                      every split, by stock, end date and line; cards or a sortable table
app/split/[series]/               split detail: price, Floor + Upside = 1 share, What if?, action panel
app/split/[series]/split/         guided split, and ?mode=rejoin to put back together
app/split/[series]/trade/         keep one half and sell the other, or buy a half with cash
app/split/[series]/final/         final price day: countdown, carve the price, collect
app/ledger/                       holdings, ready to collect, history
app/sun/  app/learn/  app/practice/   price source, the six tablets, free test shares
components/Chrome.tsx             header, nav slab, Simple/Terminal, theme, wallet, price strip, tab bar
components/WhatIf.tsx             the payoff chart and the sun-handled slider
lib/relics.ts                     the pixel relic library, generated as SVG data URIs
lib/actions.ts                    every action: amounts, what you give and get, permission, sending
lib/data.ts                       series, pool prices (or a labelled estimate), balances, positions
lib/settle.ts                     the contract's settlement rules, applied before you send
app/globals.css · app/pages.css   tokens for Basalt and Limestone, components, page layouts
```

Fonts: Gloock (headlines), Schibsted Grotesk (interface), Martian Mono (numbers), Departure Mono
(pixel stamps and the one emphasis word per page, OFL, in `app/fonts`). Each is one line in `app/layout.tsx`.

Every write passes the Robinhood Chain testnet chain id, so a wallet on another network cannot sign it.
