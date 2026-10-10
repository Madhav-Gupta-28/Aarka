"use client";

import {AnimatePresence, motion} from "motion/react";
import {useEffect, useState} from "react";
import {useActivity} from "@/lib/activity";
import type {SeriesView} from "@/lib/lens";
import {ago} from "@/lib/format";
import {explorerTx} from "@/lib/tx";

/**
 * The chain, in one line: the latest things people (and The Scales) did, one at a time. Hover
 * pauses it; the list opens on click; every line links to its public receipt.
 */
export function ActivityTicker({rows}: {rows?: SeriesView[]}) {
  const {data: items} = useActivity(rows);
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!items?.length || hold || open) return;
    const t = setInterval(() => setI((v) => (v + 1) % items.length), 4200);
    return () => clearInterval(t);
  }, [items, hold, open]);

  if (!items) return <div className="ticker"><span className="ticker-dot" /><span className="ticker-k">ON THE CHAIN</span><span className="muted">reading…</span></div>;
  if (!items.length) return <div className="ticker"><span className="ticker-dot idle" /><span className="ticker-k">ON THE CHAIN</span><span className="muted">Quiet lately. Be the first.</span></div>;
  const a = items[i % items.length];

  return (
    <div className="ticker-wrap" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
      <div className="ticker">
        <span className={`ticker-dot k-${a.kind}`} />
        <span className="ticker-k">ON THE CHAIN</span>
        <AnimatePresence mode="wait">
          <motion.a key={a.key} href={explorerTx(a.tx as `0x${string}`)} target="_blank" rel="noreferrer" className="ticker-line"
                    initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -8}} transition={{duration: 0.3}}>
            {a.text} <span className="muted">· {ago(a.at)}</span>
          </motion.a>
        </AnimatePresence>
        <button className="ticker-more mono" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "CLOSE" : `ALL ${items.length}`}</button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.ul className="ticker-list" initial={{opacity: 0, y: -6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -6}} transition={{duration: 0.2}}>
            {items.map((x) => (
              <li key={x.key}><span className={`ticker-dot k-${x.kind}`} /><a href={explorerTx(x.tx as `0x${string}`)} target="_blank" rel="noreferrer">{x.text}</a><span className="muted mono">{ago(x.at)}</span></li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
