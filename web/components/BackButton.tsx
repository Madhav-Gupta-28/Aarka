"use client";

import {AnimatePresence, motion} from "motion/react";
import {usePathname, useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {useReducedMotion} from "@/lib/ui";

/**
 * Back to wherever you just were, named. The header keeps its own record of the pages visited in
 * this tab, so the button can say "← How it works" rather than a bare arrow, and it can tell a
 * return trip from a new visit. Someone who lands deep in the site from a link has no page to go
 * back to inside Aarka, so for them it goes home; on the home page itself, with nowhere behind it,
 * it stays hidden.
 */

// Module scope, so it survives the header remounting on every page.
const trail: string[] = [];

function record(path: string) {
  if (trail[trail.length - 1] === path) return;
  if (trail[trail.length - 2] === path) trail.pop(); // a return trip, by this button or the browser's
  else trail.push(path);
}

function nameOf(path: string) {
  if (path === "/") return "Home";
  if (path.startsWith("/app")) return "App";
  if (path.startsWith("/how")) return "How it works";
  if (/^\/split\/[^/]+\/final/.test(path)) return "Final price";
  if (path.startsWith("/split/")) return "Split";
  const seg = path.split("/")[1] ?? "";
  return seg ? seg[0].toUpperCase() + seg.slice(1) : "App";
}

export function BackButton() {
  const path = usePathname();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [prev, setPrev] = useState<string | null>(null);

  useEffect(() => {
    record(path);
    setPrev(trail.length > 1 ? trail[trail.length - 2] : null);
  }, [path]);

  const to = prev ?? (path === "/" ? null : "/");
  const go = () => (prev ? router.back() : router.push("/"));

  return (
    <AnimatePresence initial={false}>
      {to && (
        <motion.button
          key="back"
          type="button"
          className="back-btn"
          onClick={go}
          aria-label={`Back to ${nameOf(to)}`}
          title="Back (Alt + ←)"
          initial={reduce ? false : {opacity: 0, x: -12, filter: "blur(4px)"}}
          animate={{opacity: 1, x: 0, filter: "blur(0px)"}}
          exit={{opacity: 0, x: -12, filter: "blur(4px)"}}
          transition={{duration: 0.32, ease: [0.22, 1, 0.36, 1]}}
        >
          <span className="back-key" aria-hidden>
            {/* A pixel arrow on the same 1px grid as the relics. */}
            <svg viewBox="0 0 8 8" width="16" height="16" shapeRendering="crispEdges">
              <path fill="currentColor" d="M3 1h1v1H3zM2 2h1v1H2zM1 3h6v2H1zM2 5h1v1H2zM3 6h1v1H3z" />
            </svg>
          </span>
          <span className="back-txt">
            <span className="back-kicker">BACK TO</span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={to} className="back-name" initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -6}} transition={{duration: 0.2}}>
                {nameOf(to)}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
