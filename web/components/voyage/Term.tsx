"use client";

import {AnimatePresence, motion} from "motion/react";
import {createContext, useContext, useEffect, useId, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {RELIC} from "@/lib/relics";
import {Relic, SunAnim} from "../Relic";
import {TERMS, type Chamber, type TermKey} from "./terms";

/**
 * A word that opens up. Hover or focus it and a preview card shows what it means, with a small
 * moving picture; "Deep dive" opens its chamber. On a phone, a tap opens the same card as a sheet.
 */

export const VoyageCtx = createContext<{open: (c: Chamber) => void}>({open: () => {}});

export function Term({k, children}: {k: TermKey; children?: React.ReactNode}) {
  const t = TERMS[k];
  const {open} = useContext(VoyageCtx);
  const ref = useRef<HTMLButtonElement>(null);
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{x: number; y: number; above: boolean; sheet: boolean} | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();

  const place = () => {
    const r = ref.current!.getBoundingClientRect();
    const sheet = innerWidth < 720;
    const above = r.bottom + 260 > innerHeight && r.top > 280;
    setPos({x: Math.max(16, Math.min(innerWidth - 336, r.left + r.width / 2 - 160)), y: above ? r.top - 10 : r.bottom + 10, above, sheet});
  };
  const enter = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { place(); setShow(true); }, 110); };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setShow(false), 180); };

  useEffect(() => {
    if (!show) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setShow(false); };
    // Close once the reader has really moved on, not on the nudge that brought the word into view.
    const y0 = scrollY;
    const scroll = () => { if (!pos?.sheet && Math.abs(scrollY - y0) > 80) setShow(false); };
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", scroll, {passive: true});
    return () => { window.removeEventListener("keydown", esc); window.removeEventListener("scroll", scroll); };
  }, [show, pos?.sheet]);

  return (
    <>
      <button ref={ref} type="button" className="term" aria-describedby={show ? id : undefined} aria-expanded={show}
              onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}
              onClick={() => { place(); setShow((v) => !v); }}>
        {children ?? t.name}<i aria-hidden>◆</i>
      </button>
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {show && pos && (
            <>
              {pos.sheet && <motion.div className="term-scrim" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} onClick={() => setShow(false)} />}
              <motion.div id={id} role="tooltip" className={`term-card${pos.sheet ? " sheet" : ""}`}
                          style={pos.sheet ? undefined : {left: pos.x, top: pos.y, transformOrigin: pos.above ? "bottom center" : "top center", translateY: pos.above ? "-100%" : 0}}
                          initial={pos.sheet ? {y: "100%"} : {opacity: 0, scale: 0.94}} animate={pos.sheet ? {y: 0} : {opacity: 1, scale: 1}}
                          exit={pos.sheet ? {y: "100%"} : {opacity: 0, scale: 0.96}} transition={{type: "spring", stiffness: 420, damping: 34}}
                          onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={leave}>
                <div className={`term-loop loop-${t.loop}`} aria-hidden><Loop k={k} /></div>
                <div className="stack" style={{gap: 6, minWidth: 0}}>
                  <strong className="display" style={{fontSize: 22, lineHeight: 1}}>{t.name}</strong>
                  <span className="small" style={{fontSize: 14}}>{t.def}</span>
                  <button className="term-dive mono" onClick={() => { setShow(false); open(t.chamber); }}>DEEP DIVE ⤢</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** The little moving picture for each term: relics and a few lines of CSS. */
function Loop({k}: {k: TermKey}) {
  switch (k) {
    case "floor": return <><Relic src={RELIC.coinFloor} size={64} /><span className="lvl" /></>;
    case "upside": return <Relic src={RELIC.coinUp} size={64} className="pulse" />;
    case "line": return <><Relic src={RELIC.coinFull} size={64} /><span className="cut" /></>;
    case "rejoin": return <><Relic src={RELIC.coinFloor} size={48} className="l" /><Relic src={RELIC.coinUp} size={48} className="r" /></>;
    case "sun": return <SunAnim size={64} />;
    case "final": return <><Relic src={RELIC.stele} size={64} /><span className="carve" /></>;
    case "scales": return <Relic src={RELIC.scales} size={64} className="rock" />;
    case "collect": return <><Relic src={RELIC.stele} size={56} /><Relic src={RELIC.coinFull} size={24} className="drop" /></>;
    case "window": return <><Relic src={RELIC.astro(0.25)} size={64} className="spin" /></>;
    case "end": return <Relic src={RELIC.astro(0.9)} size={64} />;
  }
}
