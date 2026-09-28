"use client";

import Link from "next/link";
import {useEffect, useRef, useState} from "react";
import type {SeriesView} from "@/lib/lens";
import {nowSec} from "@/lib/format";
import {Relic} from "./Relic";

/** How much of a 90-day split has passed, for the astrolabe dial. */
export function astroFrac(expiry: bigint) {
  const left = (Number(expiry) - nowSec()) / 86400;
  return Math.max(0.02, Math.min(1, 1 - left / 90));
}

export function statusOf(s: SeriesView) {
  if (s.status === 0) return {stamp: "LIVE", cls: "stamp-live", word: "Open"};
  if (s.status === 1) return {stamp: "ENDED", cls: "stamp-ended", word: "Waiting for the final price"};
  if (s.status === 2) return {stamp: "FINAL PRICE SET", cls: "stamp-final", word: "Final price set, confirming"};
  return {stamp: "READY TO COLLECT", cls: "stamp-ready", word: "Ready to collect"};
}

export function SeriesStamp({s}: {s: SeriesView}) {
  const st = statusOf(s);
  return <span className={`stamp ${st.cls}`}>{st.stamp}</span>;
}

/** The "?" next to a term: two sentences and a tiny picture, in place. */
export function Explain({name}: {name: string}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span ref={box} style={{position: "relative", display: "inline-flex"}}>
      <button className="qmark" aria-expanded={open} aria-label="What is the line?" onClick={() => setOpen(!open)}>?</button>
      {open && (
        <span role="dialog" aria-label="The line, explained" className="explain-pop" style={{left: -8, top: 40}}>
          <span className="coins"><Relic name="coinFloor" size={32} /><Relic name="coinUp" size={32} /></span>
          <span className="stack gap-8">
            <strong className="display" style={{fontSize: 24, lineHeight: 1}}>The line</strong>
            <span style={{fontSize: 16, lineHeight: 1.45}}>The price your share is split around. The Floor gets {name}&apos;s value up to it, and the Upside gets everything above it.</span>
            <button className="btn btn-sm" style={{alignSelf: "flex-start", height: 36, border: "1px solid #0E1116", background: "transparent", color: "#0E1116"}} onClick={() => setOpen(false)}>Got it</button>
          </span>
        </span>
      )}
    </span>
  );
}

export function SplitMissing({loading}: {loading: boolean}) {
  if (loading) {
    return (
      <div className="wrap section stack gap-24" aria-busy>
        <div className="skel" style={{height: 18, width: 280}} />
        <div className="skel" style={{height: 120, width: "min(640px, 100%)"}} />
        <div className="skel" style={{height: 160}} />
        <span className="label">READING THE CHAIN…</span>
      </div>
    );
  }
  return (
    <div className="wrap centre-page">
      <div className="plinth"><Relic name="fragAstro" size={256} alt="A broken astrolabe" /></div>
      <div>
        <span className="kicker">NOTHING HERE</span>
        <h1 className="display h-page">This split isn&apos;t here.</h1>
        <p className="lead">It may have ended and been fully collected, or the link is wrong. Your funds are untouched.</p>
        <div className="row gap-16 wrap-row"><Link href="/markets" className="btn btn-primary btn-lg">Browse splits</Link><Link href="/ledger" className="btn btn-secondary btn-lg">View my ledger</Link></div>
      </div>
    </div>
  );
}
