"use client";

import {useCallback, useEffect, useState} from "react";
import {ADDRESSES} from "@/lib/contracts";
import {readSeries, isFinished} from "@/lib/lens";
import {robinhoodTestnet} from "@/lib/chain";
import {PayoffChart} from "@/components/PayoffChart";
import {SeriesCard, type SeriesView} from "@/components/SeriesCard";
import {Mark} from "@/components/Mark";
import {Connect} from "@/components/Connect";
import {Split} from "@/components/Split";
import {Claim} from "@/components/Claim";
import {Settle} from "@/components/Settle";
import {Faucet, UsdgFaucet} from "@/components/Faucet";
import {Trade} from "@/components/Trade";
import {Positions} from "@/components/Positions";
import {Indicative} from "@/components/Indicative";
import {ParityPanel} from "@/components/ParityPanel";

export default function Home() {
  const [series, setSeries] = useState<SeriesView[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Paged, and without series that are settled and fully claimed: nothing is left in those.
      const rows = await readSeries();
      setSeries(rows.filter((r) => !isFinished(r)));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not reach the chain");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  // Open on the hooked series if it is still live, otherwise the nearest live one, so a first
  // visit lands on something that can be split rather than on a series that expired weeks ago.
  const defaultIndex = (() => {
    if (!series?.length) return 0;
    const hooked = series.findIndex(
      (r) => r.series.toLowerCase() === ADDRESSES.hookSeries.toLowerCase() && r.status === 0);
    if (hooked >= 0) return hooked;
    const live = series
      .map((r, i) => ({r, i}))
      .filter(({r}) => r.status === 0)
      .sort((a, b) => Number(a.r.expiry - b.r.expiry));
    return live.length ? live[0].i : 0;
  })();
  const s = series?.[active ?? defaultIndex];
  const hookedIndex = series?.findIndex((r) => r.series.toLowerCase() === ADDRESSES.hookSeries.toLowerCase()) ?? -1;
  const hooked = hookedIndex >= 0 ? series?.[hookedIndex] : undefined;
  const expired = s ? s.status !== 0 : false;

  return (
    <div className="wrap">
      <header>
        <Mark />
        <div className="brand">Aarka</div>
        <div className="net">
          <span className="netLong">{robinhoodTestnet.name}</span>
          <span className="netShort">Testnet</span>
        </div>
        <Connect />
      </header>

      <section className="hero">
        <h1>
          Own a stock? Sell its upside for cash.
          <br />
          <span className="accent">Want upside? Buy it without buying the stock.</span>
        </h1>
        <p>
          Deposit one tokenized stock, get two tradable tokens back. One takes everything up to a
          strike price. The other takes everything above it. Return both at any time to get your
          stock back. There is no borrowing anywhere in this, so there is nothing to liquidate.
        </p>
      </section>

      {s && (
        <>
          <div className="sectionHead">
            <h2>{s.underlyingSymbol} at ${(Number(s.strike) / 1e8).toFixed(0)}</h2>
            <span>what each half is worth at expiry — hover to read any price</span>
          </div>

          <div className="two">
            <div>
              <PayoffChart
                strike={s.strike}
                spot={s.priceValid ? s.spotPrice : undefined}
                settlementPrice={s.settled ? s.settlementPrice : undefined}
                underlyingSymbol={s.underlyingSymbol}
              />
              <Indicative s={s} />
              <Faucet symbol={s.underlyingSymbol} token={s.underlying} />
              <UsdgFaucet />
            </div>

            <div className="stack">
              {!expired && (
                <Trade s={s} onPickMarket={hookedIndex >= 0 ? () => setActive(hookedIndex) : undefined} />
              )}
              {s.settled ? <Claim s={s} /> : <Split s={s} />}
              {expired && !s.settled && <Settle s={s} onDone={load} />}
            </div>
          </div>
        </>
      )}

      <div className="sectionHead" style={{marginTop: 44}}>
        <h2>Series</h2>
        <span>{series ? `${series.filter((r) => r.status === 0).length} live of ${series.length} · click to switch` : ""}</span>
      </div>

      {err && <div className="skeleton">Could not reach Robinhood Chain testnet. {err}</div>}
      {!series && !err && <div className="skeleton">Reading the chain…</div>}

      <div className="grid">
        {series?.map((row, i) => (
          <SeriesCard key={row.series} s={row} onSelect={() => setActive(i)} />
        ))}
      </div>

      {series && <Positions series={series} />}
      {hooked && (
        <ParityPanel
          floorToken={hooked.floorToken}
          upsideToken={hooked.upsideToken}
          floorSymbol={hooked.floorSymbol}
          upsideSymbol={hooked.upsideSymbol}
        />
      )}

      <p className="note">
        Deployed to Robinhood Chain testnet. The stock tokens are stand-ins, because testnet has
        none; their price feeds carry the real Chainlink prices from Robinhood Chain mainnet.
        Everything else is the real protocol.{" "}
        <a href={`${robinhoodTestnet.blockExplorers.default.url}/address/${ADDRESSES.factory}`}>Factory</a>{" "}
        · <a href={`${robinhoodTestnet.blockExplorers.default.url}/address/${ADDRESSES.router}`}>Router</a>{" "}
        · <a href={`${robinhoodTestnet.blockExplorers.default.url}/address/${ADDRESSES.hook}`}>Parity hook</a>
      </p>
    </div>
  );
}
