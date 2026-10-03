# Aarka — web

Next.js 15, wagmi and viem, reading Robinhood Chain testnet directly. No backend and no indexer:
series and positions come from `AarkaLens`, pool prices from `HookLens`, a page at a time.

```sh
npm install
npm run dev          # http://localhost:3000
```

Addresses live in `lib/contracts.ts` and point at the deployed testnet set. Live at
[aarka-app.vercel.app](https://aarka-app.vercel.app).

## Structure

```
app/page.tsx                  home: the ASCII sun hero, the coin that splits, why it can be trusted
app/app/                      the app: earn cash or bet on a rise, then your positions (Pro: the terminal)
app/how/                      how it works: four moving pictures, three questions, the full mechanism
app/split/[series]/           one split: price, payoff, actions (?do=split|buy|sell|rejoin), parity modal
app/split/[series]/final/     the final day: carve the price, then collect

components/AppCard.tsx        the two-intent card and the confirmation moment
components/HowBody.tsx        the four animated pictures and the technical drawer
components/CoinBreak.tsx      the scroll-pinned coin that cracks, splits and re-forms
components/ParityModal.tsx    the parity hook, live, with a trade to push it off balance
components/Chrome.tsx         header, nav, Simple/Pro, wallet, footers, phone tab bar

lib/actions.ts                every action: amounts, what you give and get, permission, sending
lib/tx.ts                     simulate first, then send; contract errors explained by name
lib/data.ts                   series, pool prices (or a labelled estimate), balances, positions
lib/settle.ts                 the contract's settlement rules, applied before you send
lib/relics.ts                 the pixel art, generated in code as SVG data URIs
```

Fonts: Gloock (headlines), Schibsted Grotesk (interface), Martian Mono (numbers) and Departure Mono
(pixel stamps, OFL, in `app/fonts`). The old routes (`/markets`, `/ledger`, `/practice`, `/learn`,
`/sun`) redirect to their new homes in `next.config.js`.

Every write is simulated before the wallet opens and names the Robinhood Chain testnet chain id, so
a call the chain would refuse costs nothing and a wallet on another network cannot sign it.
