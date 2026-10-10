"use client";

import {AnimatePresence, motion} from "motion/react";
import {useEffect, useRef, useState} from "react";
import {downloadCard, shareCard, type Card} from "@/lib/shareCard";
import {explorerTx} from "@/lib/tx";
import {useReducedMotion} from "@/lib/ui";
import {DigitRoll} from "./Motion";
import {Relic} from "./Relic";

/**
 * The moment it's done. The coin splits on screen, the kept half settles in the middle, the
 * number rolls up, and there are three things to do next: see it in your positions, share it, or
 * check the public receipt. Escape or a click outside closes it.
 */

export type Done = {
  practice?: boolean;  // a practice run: nothing was sent, so nothing to share or look up
  half: "floor" | "upside";
  big: string;       // the number that rolls: "$1.66" or "4.212"
  unit: string;      // "in cash" or "Upsides"
  line: string;      // one sentence of what just happened
  hash?: `0x${string}`;
  card: Card;
};

export function Moment({done, onClose, onReal}: {done: Done | null; onClose: () => void; onReal?: () => void}) {
  const reduce = useReducedMotion();
  const [sharing, setSharing] = useState<"" | "busy" | "posted" | "shared">("");
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!done) return;
    setSharing("");
    const t = setTimeout(() => primary.current?.focus(), 400);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(t); window.removeEventListener("keydown", esc); };
  }, [done, onClose]);

  const toPositions = () => {
    onClose();
    setTimeout(() => document.getElementById("positions")?.scrollIntoView({behavior: reduce ? "auto" : "smooth", block: "start"}), 60);
  };

  return (
    <AnimatePresence>
      {done && (
        <motion.div className="moment" role="dialog" aria-modal="true" aria-labelledby="moment-h"
                    initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.25}}
                    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div className="moment-card" initial={reduce ? false : {y: 28, scale: 0.96}} animate={{y: 0, scale: 1}} exit={{y: 16, opacity: 0}} transition={{type: "spring", stiffness: 260, damping: 26}}>
            <div className="moment-stage" aria-hidden>
              {/* Earned cash: banknotes rain down. Bet on a rise: gold sparks lift. */}
              {!reduce && Array.from({length: done.half === "floor" ? 16 : 22}, (_, i) => (
                <span key={i} className={done.half === "floor" ? "m-note" : "m-spark"}
                      style={{left: `${(i * 37) % 100}%`, animationDelay: `${(i % 8) * 0.12 + 0.35}s`, ["--dx" as string]: `${((i * 53) % 60) - 30}px`}} />
              ))}
              <motion.span className="moment-sun" initial={reduce ? false : {scale: 0.2, opacity: 0}} animate={{scale: 1, opacity: 1}} transition={{duration: 0.9, ease: [0.22, 1, 0.36, 1]}} />
              {/* One coin, then two halves: the kept one comes forward, the other drifts off. */}
              <motion.span className="moment-coin" initial={reduce ? false : {opacity: 1, scale: 1}} animate={{opacity: 0, scale: 1.08}} transition={{delay: 0.35, duration: 0.25}}>
                <Relic name="coinFull" size={128} />
              </motion.span>
              {(["floor", "upside"] as const).map((h) => {
                const kept = h === done.half;
                const dir = h === "floor" ? -1 : 1;
                return (
                  <motion.span key={h} className="moment-half"
                               initial={reduce ? false : {x: 0, opacity: 0, rotate: 0}}
                               animate={kept ? {x: 0, opacity: 1, rotate: 0, scale: 1.08} : {x: dir * 150, y: 30, opacity: 0.22, rotate: dir * 14, scale: 0.8}}
                               transition={{delay: 0.4, type: "spring", stiffness: 140, damping: 16}}>
                    <Relic name={h === "floor" ? "coinFloor" : "coinUp"} size={128} />
                  </motion.span>
                );
              })}
            </div>

            <span className="kicker" style={{textAlign: "center"}}>{done.practice ? "PRACTICE RUN · NOTHING WAS SENT" : <>CONFIRMED · IT&apos;S YOURS</>}</span>
            <div className="moment-num" id="moment-h">
              <DigitRoll text={done.big} size={72} className="gold" style={{letterSpacing: "-.04em"}} />
              <span className="lead" style={{fontSize: 20}}>{done.unit}</span>
            </div>
            <p className="body center" style={{maxWidth: 440, margin: "0 auto"}}>{done.line}</p>

            {done.practice ? (
              <>
                <div className="moment-acts">
                  <button ref={primary} className="btn btn-primary btn-lg" onClick={() => onReal?.()}>Make it real →</button>
                  <button className="btn btn-secondary btn-lg" onClick={toPositions}>See it on my shelf ↓</button>
                </div>
                <div className="row gap-16 wrap-row" style={{justifyContent: "center"}}>
                  <span className="small muted">That&apos;s exactly how it goes for real, with test money instead of pretend.</span>
                  <button className="btn-link mono muted" onClick={onClose}>Keep practising</button>
                </div>
              </>
            ) : (
              <>
                <div className="moment-acts">
                  <button ref={primary} className="btn btn-primary btn-lg" onClick={toPositions}>See it in my positions ↓</button>
                  <button className="btn btn-secondary btn-lg" disabled={sharing === "busy"}
                          onClick={async () => { setSharing("busy"); setSharing(await shareCard(done.card) === "shared" ? "shared" : "posted"); }}>
                    {sharing === "busy" ? "Drawing the card…" : sharing === "posted" ? "✓ Card saved, post opened" : sharing === "shared" ? "✓ Shared" : "Share on X"}
                  </button>
                </div>
                <div className="row gap-16 wrap-row" style={{justifyContent: "center"}}>
                  <button className="btn-link mono" onClick={() => downloadCard(done.card)}>Download the card</button>
                  {done.hash && <a className="mono" href={explorerTx(done.hash)} target="_blank" rel="noreferrer">Public receipt ↗</a>}
                  <button className="btn-link mono muted" onClick={onClose}>Close</button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
