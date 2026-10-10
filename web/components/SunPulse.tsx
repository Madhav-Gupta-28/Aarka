"use client";

import {AnimatePresence, motion} from "motion/react";
import {useEffect, useRef, useState} from "react";
import {stocksOf, useSeries} from "@/lib/data";
import {money, stockName} from "@/lib/format";
import {play} from "@/lib/sound";
import {useReducedMotion} from "@/lib/ui";
import {SunAnim} from "./Relic";

/**
 * When The Sun publishes a new price, the whole site feels it: a ring of light leaves the top of
 * the screen and a note drops from the header saying what changed. Every rolling number on the
 * page rolls to the new value on its own. Only real updates trigger it, never the first load.
 */
export function SunPulse() {
  const {data: rows} = useSeries();
  const reduce = useReducedMotion();
  const seen = useRef<Map<string, bigint> | null>(null);
  const [beat, setBeat] = useState<{id: number; text: string} | null>(null);

  useEffect(() => {
    const st = stocksOf(rows);
    if (!st.length) return;
    if (!seen.current) { seen.current = new Map(st.map((s) => [s.symbol, s.updatedAt])); return; }
    const fresh = st.filter((s) => (seen.current!.get(s.symbol) ?? 0n) < s.updatedAt);
    st.forEach((s) => seen.current!.set(s.symbol, s.updatedAt));
    if (fresh.length) fire(fresh.map((s) => `${stockName(s.symbol)} ${money(s.spot)}`).join(" · "));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Anything can ask for a beat (and it's how this is tested): window.dispatchEvent(new CustomEvent("aarka:sun", {detail: "..."}))
  useEffect(() => {
    const on = (e: Event) => fire(String((e as CustomEvent).detail ?? "A new price"));
    window.addEventListener("aarka:sun", on);
    return () => window.removeEventListener("aarka:sun", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function fire(text: string) {
    setBeat({id: Date.now(), text});
    play("tick");
    window.setTimeout(() => setBeat((b) => (b && Date.now() - b.id > 3800 ? null : b)), 4000);
  }

  return (
    <AnimatePresence>
      {beat && (
        <motion.div key={beat.id} className="sun-pulse" aria-live="polite" initial={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.5}}>
          {!reduce && <span className="sun-ring" />}
          <motion.div className="sun-note" initial={{y: -60, opacity: 0}} animate={{y: 0, opacity: 1}} exit={{y: -40, opacity: 0}} transition={{type: "spring", stiffness: 380, damping: 30}}>
            <SunAnim size={24} /><b>THE SUN</b><span>new price · {beat.text}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
