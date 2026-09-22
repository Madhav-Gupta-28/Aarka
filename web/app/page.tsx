"use client";

import Link from "next/link";
import {useData} from "@/components/DataProvider";
import {StatStrip} from "@/components/StatStrip";
import {PayoffChart} from "@/components/PayoffChart";
import {ADDRESSES, marketFor} from "@/lib/contracts";
import {usd, cash, expiryLabel, countdown} from "@/lib/format";

export default function Home() {
  const {series, parity, error} = useData();

  // Land on the flagship if it is still live, otherwise the nearest live market, so the chart is
  // always showing something a visitor can actually go and trade.
  const live = (series ?? []).filter((s) => s.status === 0 && !!marketFor(s.series));
  const s = live.find((r) => r.series.toLowerCase() === ADDRESSES.flagshipSeries.toLowerCase())
    ?? [...live].sort((a, b) => Number(b.expiry - a.expiry))[0];
  const p = s ? parity.get(s.series.toLowerCase()) : undefined;

  return (
    <>
      <section className="lead">
        <h1>
          Own a stock? Sell its upside for cash.{" "}
          <span className="accent">Want upside? Buy it without buying the stock.</span>
        </h1>
        <p>
          Deposit one tokenized share, get two tradable tokens back. One takes everything up to a
          strike price, the other takes everything above it. Return both at any time to get your
          share back. Nothing is borrowed anywhere in this, so there is nothing to liquidate.
        </p>
        <div className="leadBtns">
          <Link className="btn primary" href="/markets">Browse markets</Link>
          <Link className="btn" href="/docs">How it works</Link>
        </div>
      </section>

      {error && <div className="err">Could not reach Robinhood Chain testnet. {error}</div>}
      {series && <StatStrip series={series} />}

      {s && (
        <section className="section">
          <div className="sectionHead">
            <h2>{s.underlyingSymbol} at {usd(s.strike, 0)}</h2>
            <span>
              what each half is worth at expiry — {expiryLabel(s.expiry)}, {countdown(s.expiry)} away
            </span>
          </div>

          <div className="work">
            <div>
              <PayoffChart
                strike={s.strike}
                spot={s.priceValid ? s.spotPrice : undefined}
                underlyingSymbol={s.underlyingSymbol}
              />
            </div>

            <div className="stack">
              <div className="panel">
                <b className="panelTitle">What the market pays for each half today</b>
                {p ? (
                  <div className="ledger" style={{margin: "14px 0 0", border: 0}}>
                    <div className="lrow"><span>{s.floorSymbol}</span><b>{cash(p.floorPrice)}</b></div>
                    <div className="lrow"><span>{s.upsideSymbol}</span><b>{cash(p.upsidePrice)}</b></div>
                    <div className="lrow sum"><span>together</span><b>{cash(p.sumOfHalves)}</b></div>
                    <div className="lrow"><span>one whole share</span><b>{cash(p.underlyingPrice)}</b></div>
                  </div>
                ) : (
                  <p className="explain">Reading the pools…</p>
                )}
                <Link className="btn primary full" href={`/markets/${s.series}`}>
                  Open this market
                </Link>
                <p className="hint">
                  The two halves add up because a hook makes them. If they drift, it buys the cheap
                  side and sells the dear one inside the very next swap.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="sectionHead">
          <h2>Three things you can do</h2>
          <span>each is one transaction</span>
        </div>
        <div className="howGrid">
          <div className="how">
            <i>HOLDER</i>
            <b>Take cash for your gains</b>
            <p>
              Deposit a share, keep the floor, sell the upside. You are paid today for everything
              the stock might earn above the strike, and you keep the rest of its value.
            </p>
          </div>
          <div className="how">
            <i>SPECULATOR</i>
            <b>Buy upside, not leverage</b>
            <p>
              Pay only for what the stock earns above a strike by a date. If it finishes below, the
              token pays nothing — but nobody was ever able to liquidate you on the way.
            </p>
          </div>
          <div className="how">
            <i>ANYONE</i>
            <b>Change your mind</b>
            <p>
              Hold one of each half and the vault swaps them back for a whole share, at any time,
              for no fee. Holding both is exactly holding the stock.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="sectionHead">
          <h2>Built to be checked, not trusted</h2>
          <span></span>
        </div>
        <div className="howGrid">
          <div className="how">
            <i>SETTLEMENT</i>
            <b>Anyone can close a series</b>
            <p>
              The settler names a feed round and the contract proves it is the right one. A
              challenge window lets anyone replace it with a better round.{" "}
              <Link href="/settle">The queue →</Link>
            </p>
          </div>
          <div className="how">
            <i>PARITY</i>
            <b>The halves have to add up</b>
            <p>
              A Uniswap v4 hook enforces the identity after every swap and pays what it earns to
              liquidity providers. Break it yourself and watch.{" "}
              <Link href="/parity">Live parity →</Link>
            </p>
          </div>
          <div className="how">
            <i>AUDIT</i>
            <b>Every finding written down</b>
            <p>
              Reviewed twice, plus a third round found in manual testing — including one where the
              hook went quiet on the largest swaps. All of it is in the repository.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
