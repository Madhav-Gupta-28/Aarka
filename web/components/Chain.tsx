"use client";

import {Fragment} from "react";
import {useRouter} from "next/navigation";
import {STATUS_LABEL, marketFor} from "@/lib/contracts";
import {usd, units, pct, cash, expiryLabel, countdown} from "@/lib/format";
import {useData} from "./DataProvider";
import type {SeriesView} from "@/lib/types";

/**
 * The option chain, which is how anyone choosing between these actually thinks.
 *
 * One table per underlying, expiries banded inside it, strikes sorted within each band. A flat
 * list of cards makes you compare from memory; this puts the only two numbers that vary — strike
 * and date — in the two places your eye already goes, and prints what each half costs beside them.
 */
export function Chain({rows}: {rows: SeriesView[]}) {
  const router = useRouter();
  const {parity} = useData();

  const byTicker = new Map<string, SeriesView[]>();
  for (const s of rows) {
    const list = byTicker.get(s.underlyingSymbol) ?? [];
    list.push(s);
    byTicker.set(s.underlyingSymbol, list);
  }

  return (
    <>
      {[...byTicker.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ticker, all]) => {
        const lead = all[0];

        // Expiries in date order; strikes ascending inside each.
        const byExpiry = new Map<string, SeriesView[]>();
        for (const s of [...all].sort((a, b) => Number(a.strike - b.strike))) {
          const key = s.expiry.toString();
          const list = byExpiry.get(key) ?? [];
          list.push(s);
          byExpiry.set(key, list);
        }
        const expiries = [...byExpiry.entries()].sort(([a], [b]) => Number(BigInt(a) - BigInt(b)));

        return (
          <section className="chainGroup" key={ticker}>
            <div className="chainHead">
              <h2>{ticker}</h2>
              <span className="spot">
                {lead.priceValid ? usd(lead.spotPrice) : lead.settled ? usd(lead.settlementPrice) : "—"}
              </span>
              <span className="meta">
                {all.length} {all.length === 1 ? "series" : "series"} · {expiries.length}{" "}
                {expiries.length === 1 ? "expiry" : "expiries"}
              </span>
            </div>

            <div className="chainTable">
              <div className="chainScroll">
                <table>
                  <thead>
                    <tr>
                      <th>Strike</th>
                      <th>Floor</th>
                      <th>Upside</th>
                      <th>Together</th>
                      <th>Parity</th>
                      <th>Deposited</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiries.map(([key, group]) => (
                      <Fragment key={key}>
                        <tr className="bandRow">
                          <td colSpan={7}>
                            <span className="band">{expiryLabel(group[0].expiry)}</span>
                            <span className="bandNote">
                              {group[0].status === 0
                                ? `${countdown(group[0].expiry)} left`
                                : STATUS_LABEL[group[0].status]}
                            </span>
                          </td>
                        </tr>
                        {group.map((s) => {
                          const p = parity.get(s.series.toLowerCase());
                          const hasMarket = !!marketFor(s.series);
                          const ref = s.settled ? s.settlementPrice : s.spotPrice;
                          return (
                            <tr key={s.series} onClick={() => router.push(`/markets/${s.series}`)}>
                              <td className="strikeCell">
                                <b>{usd(s.strike, 0)}</b>{" "}
                                <span className="moneyness">{ref > s.strike ? "in" : "out"}</span>
                              </td>
                              <td className="num floorNum">
                                {p ? cash(p.floorPrice) : <span className="dash">—</span>}
                              </td>
                              <td className="num">
                                {p ? cash(p.upsidePrice) : <span className="dash">—</span>}
                              </td>
                              <td className="num">
                                {p ? cash(p.sumOfHalves) : <span className="dash">—</span>}
                              </td>
                              <td>
                                {p ? (
                                  <span className={`gapTag ${p.gapBps < p.minDeviationBps ? "ok" : "off"}`}>
                                    {p.gapBps.toString()} bps
                                  </span>
                                ) : (
                                  <span className="dash">{hasMarket ? "…" : "no market"}</span>
                                )}
                              </td>
                              <td className="num">
                                {units(s.totalDeposited, 0)}
                                <span className="sub">{s.underlyingSymbol}</span>
                              </td>
                              <td>
                                {s.settled ? (
                                  <span className="num">
                                    {pct(s.floorPayoutPerUnit)} / {pct(s.upsidePayoutPerUnit)}
                                  </span>
                                ) : (
                                  <span className={`pill ${s.status === 0 ? "open" : ""}`}>
                                    {STATUS_LABEL[s.status]}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}
