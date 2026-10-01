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
app/page.tsx                      home: ASCII sun hero, the coin-break story, the way into the app, trust
app/app/                          the app: earn cash or bet on a rise, your positions; Pro is the terminal
app/how/                          how it works: the six tablets, then The Sun, where every price comes from
app/split/[series]/               split detail: price, Floor + Upside = 1 share, What if?, action panel
                                  (?do=split|buy|sell|rejoin opens that tab); switches to final once ended
app/split/[series]/final/         final price day: countdown, carve the price, collect
components/Chrome.tsx             header, back button, nav slab, sound, Simple/Pro, wallet, strip, tab bar
components/AppCard.tsx            the two-intent card, the confirmation moment, the first-visit hints
components/CoinBreak.tsx          the scroll-pinned coin that cracks, splits and re-forms
components/SonarAscii.tsx         the tablet drawn in characters, with sonar from the sun
components/Teleport.tsx           the pixel page transition
components/WhatIf.tsx             the payoff chart and the sun-handled slider
lib/relics.ts                     the pixel relic library, generated as SVG data URIs
lib/actions.ts                    every action: amounts, what you give and get, permission, sending
lib/data.ts                       series, pool prices (or a labelled estimate), balances, positions
lib/settle.ts                     the contract's settlement rules, applied before you send
lib/sound.ts · lib/shareCard.ts   Web Audio sounds (off by default) and the 1200×630 share image
app/globals.css · app/pages.css   tokens for Basalt and Limestone, components, page layouts
```

Fonts: Gloock (headlines), Schibsted Grotesk (interface), Martian Mono (numbers), Departure Mono
(pixel stamps and the one emphasis word per page, OFL, in `app/fonts`). Each is one line in `app/layout.tsx`.

The old routes (/markets, /ledger, /practice, /learn, /sun and the split sub-pages) redirect to
their new homes in `next.config.js`.

Every write passes the Robinhood Chain testnet chain id, so a wallet on another network cannot sign it.
