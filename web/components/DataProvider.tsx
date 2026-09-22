"use client";

import {createContext, useCallback, useContext, useEffect, useMemo, useState} from "react";
import {useAccount} from "wagmi";
import {readSeries, readPositions} from "@/lib/lens";
import {readParityBySeries, type Parity} from "@/lib/marketData";
import type {Position, SeriesView} from "@/lib/types";

type Data = {
  series: SeriesView[] | null;
  parity: Map<string, Parity>;
  positions: Position[];
  error: string | null;
  refresh: () => void;
};

const Ctx = createContext<Data>({
  series: null, parity: new Map(), positions: [], error: null, refresh: () => {},
});

/**
 * One poller for the whole site.
 *
 * Every page here shows some view of the same two reads — the series list and the parity of each
 * market — so polling them per page would multiply the same traffic by however many panels happen
 * to be mounted. This holds them once and hands them down, which also means moving between pages
 * shows data immediately instead of an empty frame while a fresh read lands.
 */
export function DataProvider({children}: {children: React.ReactNode}) {
  const {address} = useAccount();
  const [series, setSeries] = useState<SeriesView[] | null>(null);
  const [parity, setParity] = useState<Map<string, Parity>>(new Map());
  const [positions, setPositions] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [rows, marks] = await Promise.all([readSeries(), readParityBySeries()]);
        if (!live) return;
        setSeries(rows);
        setParity(marks);
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "could not reach the chain");
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, [tick]);

  useEffect(() => {
    if (!address) { setPositions([]); return; }
    let live = true;
    const load = () =>
      readPositions(address).then((r) => { if (live) setPositions(r); }).catch(() => {});
    load();
    const t = setInterval(load, 12_000);
    return () => { live = false; clearInterval(t); };
  }, [address, tick]);

  const value = useMemo(
    () => ({series, parity, positions, error, refresh}),
    [series, parity, positions, error, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useData = () => useContext(Ctx);

/** The parity reading for one series, or undefined when it has no market. */
export function useParity(series?: `0x${string}`) {
  const {parity} = useData();
  return series ? parity.get(series.toLowerCase()) : undefined;
}
