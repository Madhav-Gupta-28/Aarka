"use client";

import {AnimatePresence, motion} from "motion/react";
import {useCallback, useEffect, useLayoutEffect, useState} from "react";
import {play} from "@/lib/sound";
import {useReducedMotion} from "@/lib/ui";

/**
 * Three hints, once. The first time someone opens the app, it points at the three things that
 * matter, in order: what you want, where the line is, what you get. It dims the rest of the page
 * around each one. Skip ends it, and it never comes back in this browser.
 */

export type Step = {sel: string; kicker: string; title: string; body: string};

const KEY = "aarka.tour";

export function Tour({steps, id = "app", delay = 900}: {steps: Step[]; id?: string; delay?: number}) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(-1);
  const [box, setBox] = useState<DOMRect | null>(null);

  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(`${KEY}.${id}`) === "done"; } catch { seen = true; }
    if (seen) return;
    const t = setTimeout(() => setI(0), delay);
    return () => clearTimeout(t);
  }, [id, delay]);

  const end = useCallback(() => {
    setI(-1);
    try { localStorage.setItem(`${KEY}.${id}`, "done"); } catch { /* not remembered */ }
  }, [id]);

  const step = i >= 0 ? steps[i] : null;

  // Bring the target into view, then follow it as the page moves.
  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector(step.sel);
    if (!el) { end(); return; }
    el.scrollIntoView({behavior: reduce ? "auto" : "smooth", block: "center"});
    const measure = () => setBox(el.getBoundingClientRect());
    measure();
    let raf = 0;
    const follow = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener("scroll", follow, {passive: true});
    window.addEventListener("resize", follow);
    const settle = setInterval(measure, 120); // smooth scroll moves it for a while
    const stop = setTimeout(() => clearInterval(settle), 1400);
    return () => { window.removeEventListener("scroll", follow); window.removeEventListener("resize", follow); clearInterval(settle); clearTimeout(stop); cancelAnimationFrame(raf); };
  }, [step, reduce, end]);

  useEffect(() => {
    if (!step) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const next = () => {
    play("tick");
    if (i >= steps.length - 1) end(); else setI(i + 1);
  };

  const pad = 10;
  const below = box ? box.bottom + 220 < innerHeight || box.top < 240 : true;
  const cardTop = box ? (below ? Math.min(innerHeight - 220, box.bottom + pad + 14) : Math.max(16, box.top - pad - 14 - 190)) : 0;
  const cardLeft = box ? Math.max(16, Math.min(innerWidth - 16 - Math.min(380, innerWidth - 32), box.left)) : 16;

  return (
    <AnimatePresence>
      {step && box && (
        <motion.div key="tour" className="tour" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.25}}>
          <motion.div className="tour-hole" aria-hidden
                      animate={{top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2}}
                      transition={reduce ? {duration: 0} : {type: "spring", stiffness: 300, damping: 34}} />
          <motion.div key={i} className="tour-card" role="dialog" aria-live="polite" aria-label={`Hint ${i + 1} of ${steps.length}`}
                      style={{top: cardTop, left: cardLeft}}
                      initial={reduce ? false : {opacity: 0, y: below ? 8 : -8}} animate={{opacity: 1, y: 0}} transition={{duration: 0.25}}>
            <span className="kicker">{step.kicker} · {i + 1} OF {steps.length}</span>
            <strong className="display" style={{fontSize: 26, lineHeight: 1.1}}>{step.title}</strong>
            <p className="small">{step.body}</p>
            <div className="row" style={{justifyContent: "space-between", alignItems: "center", marginTop: 4}}>
              <div className="tour-dots" aria-hidden>{steps.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}</div>
              <div className="row gap-12">
                <button className="btn-link muted mono" onClick={end}>Skip</button>
                <button className="btn btn-primary btn-sm" onClick={next} autoFocus>{i === steps.length - 1 ? "Got it" : "Next →"}</button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
