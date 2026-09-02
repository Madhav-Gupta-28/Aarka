"use client";

import {useCallback, useEffect, useState} from "react";
import {publicClient} from "@/lib/client";
import {ADDRESSES, LENS_ABI} from "@/lib/contracts";
import {robinhoodTestnet} from "@/lib/chain";
import {PayoffChart} from "@/components/PayoffChart";
import {SeriesCard, type SeriesView} from "@/components/SeriesCard";
import {Mark} from "@/components/Mark";
import {Connect} from "@/components/Connect";
import {Split} from "@/components/Split";
import {Claim} from "@/components/Claim";
import {Settle} from "@/components/Settle";
import {Faucet} from "@/components/Faucet";
import {Positions} from "@/components/Positions";
import {Indicative} from "@/components/Indicative";
import {ParityPanel} from "@/components/ParityPanel";

export default function Home() {
  const [series, setSeries] = useState<SeriesView[] | null>(null);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = (await publicClient.readContract({
        address: ADDRESSES.lens as `0x${string}`, abi: LENS_ABI, functionName: "allSeries",
      })) as unknown as SeriesView[];
      setSeries([...rows]);
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

  const s = series?.[active];
  const expired = s ? s.status !== 0 : false;

  return (
    <div className="wrap">
      <header>
        <Mark />
        <div className="brand">Aarka</div>
        <div className="net">{robinhoodTestnet.name}</div>
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
              <Faucet symbol={s.underlyingSymbol} />
            </div>

            <div>
              {s.settled ? <Claim s={s} /> : <Split s={s} />}
              {expired && !s.settled && <Settle s={s} onDone={load} />}
            </div>
          </div>
        </>
      )}

      <div className="sectionHead" style={{marginTop: 44}}>
        <h2>Series</h2>
        <span>{series ? `${series.length} live · click to switch` : ""}</span>
      </div>

      {err && <div className="skeleton">Could not reach Robinhood Chain testnet. {err}</div>}
      {!series && !err && <div className="skeleton">Reading the chain…</div>}

      <div className="grid">
        {series?.map((row, i) => (
          <SeriesCard key={row.series} s={row} onSelect={() => setActive(i)} />
        ))}
      </div>

      {series && <Positions series={series} />}
      {series && series[0] && (
        <ParityPanel
          floorToken={series[0].floorToken}
          upsideToken={series[0].upsideToken}
          floorSymbol={series[0].floorSymbol}
          upsideSymbol={series[0].upsideSymbol}
        />
      )}

      <p className="note">
        Deployed to Robinhood Chain testnet. The stock token and the price feed are stand-ins,
        because testnet carries neither — everything else is the real protocol.{" "}
        <a href={`${robinhoodTestnet.blockExplorers.default.url}/address/${ADDRESSES.factory}`}>Factory</a>{" "}
        · <a href={`${robinhoodTestnet.blockExplorers.default.url}/address/${ADDRESSES.hook}`}>Parity hook</a>
      </p>
    </div>
  );
}
