"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {useData} from "@/components/DataProvider";
import {readArbHistory, type ArbEvent} from "@/lib/marketData";
import {marketFor} from "@/lib/contracts";
import {explorer} from "@/lib/chain";
import {cash, units, usd, shortAddr} from "@/lib/format";
import {ParityDemo} from "@/components/ParityDemo";

/**
 * The hook, shown working rather than described.
 *
 * Two halves trade in two separate pools, and nothing in an AMM makes their prices sum to the
 * stock. A hook checks after every swap and, when they drift, trades all three pools inside the
 * same transaction and hands the profit to the liquidity providers. The table is the current state
 * of that; the log underneath is every time it has actually fired.
 */
export default function ParityPage() {
  const {series, parity} = useData();
  const [events, setEvents] = useState<ArbEvent[] | null>(null);

  useEffect(() => {
    let live = true;
    readArbHistory().then((e) => { if (live) setEvents(e); }).catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
  }, []);

  const rows = (series ?? []).filter((s) => !!marketFor(s.series));
  const worst = [...parity.values()].reduce((m, p) => (p.gapBps > m ? p.gapBps : m), 0n);
  const totalPaid = events?.reduce((a, e) => a + e.profit, 0n) ?? 0n;
  const byAddr = new Map((series ?? []).map((s) => [s.series.toLowerCase(), s]));

  return (
    <>
      <div className="pageHead">
        <div>
          <span className="eyebrow">Parity</span>
          <h1>The two halves have to add up</h1>
          <p>
            Every other arbitrage hook guesses at a fair value it cannot see. This one does not
            guess: the vault mints and redeems one-for-one at any price, so the relationship it
            enforces is an identity, not an estimate.
          </p>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span>Markets watched</span>
          <b>{rows.length}</b>
          <em>a hook each</em>
        </div>
        <div className="stat">
          <span>Widest gap right now</span>
          <b>{worst.toString()} bps</b>
          <em>threshold is 100</em>
        </div>
        <div className="stat">
          <span>Times it has fired</span>
          <b>{events === null ? "…" : events.length}</b>
          <em>last four days</em>
        </div>
        <div className="stat">
          <span>Paid to liquidity providers</span>
          <b>{events === null ? "…" : cash(totalPaid)}</b>
          <em>donated, not kept</em>
        </div>
      </div>

      <section className="section">
        <div className="sectionHead">
          <h2>Every market, right now</h2>
          <span>floor + upside against the stock pool</span>
        </div>
        <div className="chainTable">
          <div className="chainScroll">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Floor</th>
                  <th>Upside</th>
                  <th>Together</th>
                  <th>Stock</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const p = parity.get(s.series.toLowerCase());
                  const ok = p && p.gapBps < p.minDeviationBps;
                  return (
                    <tr key={s.series} onClick={() => location.assign(`/markets/${s.series}`)}>
                      <td>
                        <b>{s.underlyingSymbol} {usd(s.strike, 0)}</b>
                        <span className="sub">{s.floorSymbol}</span>
                      </td>
                      <td className="num floorNum">{p ? cash(p.floorPrice) : "—"}</td>
                      <td className="num">{p ? cash(p.upsidePrice) : "—"}</td>
                      <td className="num">{p ? cash(p.sumOfHalves) : "—"}</td>
                      <td className="num">{p ? cash(p.underlyingPrice) : "—"}</td>
                      <td>
                        {p ? (
                          <span className={`gapTag ${ok ? "ok" : "off"}`}>
                            {p.gapBps.toString()} bps {ok ? "· at parity" : p.halvesDear ? "· dear" : "· cheap"}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <ParityDemo />

      <section className="section">
        <div className="sectionHead">
          <h2>Every time the hook has acted</h2>
          <span>decoded from the chain, newest first</span>
        </div>
        {events === null && <div className="loading">Reading the logs…</div>}
        {events?.length === 0 && (
          <div className="empty">
            <b>Nothing in the last four days</b>
            <p>
              The hook only fires when a gap opens past 100 bps, and ordinary trades do not move
              these pools that far. Break parity yourself above and it will appear here within a
              few seconds.
            </p>
          </div>
        )}
        {events && events.length > 0 && (
          <div className="actTable">
            {events.slice(0, 40).map((e) => {
              const s = e.series ? byAddr.get(e.series.toLowerCase()) : undefined;
              return (
                <div className="actRow" key={`${e.txHash}-${e.blockNumber}`}>
                  <span className={`kind ${e.retired ? "retired" : e.minted ? "mint" : "redeem"}`}>
                    {e.minted ? "minted" : "redeemed"}
                  </span>
                  <span className="what">
                    <b>{units(e.size)}</b> {s?.underlyingSymbol ?? "shares"}
                    {s && <> · {s.underlyingSymbol} {usd(s.strike, 0)}</>}
                    {e.retired && <span className="retiredTag">retired hook</span>}
                  </span>
                  <span className="paid">{cash(e.profit)} to LPs</span>
                  <a href={explorer("tx", e.txHash)} target="_blank" rel="noreferrer">
                    {shortAddr(e.txHash)}
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="hint" style={{marginTop: 20}}>
        Prior art, stated honestly: a v4 hook that arbitrages inside <code>afterSwap</code> is not
        new. What is claimed here is the application — redemption arbitrage on a structured pair
        where the vault, not a price oracle, defines the relationship.{" "}
        <Link href="/docs">How it works →</Link>
      </p>
    </>
  );
}
