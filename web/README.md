# Aarka — web

Next.js 15 + viem, reading Robinhood Chain testnet directly. No backend, no indexer: the whole
page is one `AarkaLens.allSeries()` call.

```sh
npm install
npm run dev          # http://localhost:3000
```

Addresses live in `lib/contracts.ts` and point at the deployed testnet set.

## Structure

```
components/PayoffChart.tsx   the two payoffs, drawn. hover reads any price
components/SeriesCard.tsx    one series, its terms and its two halves
lib/contracts.ts             addresses + the minimal ABIs actually used
lib/client.ts                viem public client
```
