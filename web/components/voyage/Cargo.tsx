"use client";

import {AnimatePresence, motion} from "motion/react";
import {RELIC} from "@/lib/relics";
import {Relic, SunAnim} from "../Relic";

/**
 * What the boat carries, and how it changes at each port. Pieces that carry on from one port to
 * the next keep their key, so they glide into their new place instead of popping: the whole coin
 * becomes two halves, the halves rise and fall through three endings, and so on.
 *
 *   0 the share     a whole coin
 *   1 the line      the coin, with a line carved across it
 *   2 two halves    the coin parts into Floor and Upside
 *   3 endings       the halves light and dim as the ending changes
 *   4 final day     a stele, the price carved in it
 *   5 the sun       the sun disk
 *   6 the scales    the balance, rocking
 *   7 the risks     the Upside fades to nothing, the Floor sinks
 */

const spring = {type: "spring", stiffness: 220, damping: 22} as const;

export function Cargo({stage, size = 56}: {stage: number; size?: number}) {
  const half = size * 0.82;
  const piece = (key: string, node: React.ReactNode, at: {x?: number; y?: number; scale?: number; opacity?: number; rotate?: number}, cls = "") => (
    <motion.span key={key} className={`cargo-p ${cls}`} layout
                 initial={{opacity: 0, scale: 0.4, filter: "blur(6px)"}}
                 animate={{opacity: at.opacity ?? 1, scale: at.scale ?? 1, x: at.x ?? 0, y: at.y ?? 0, rotate: at.rotate ?? 0, filter: "blur(0px)"}}
                 exit={{opacity: 0, scale: 0.5, filter: "blur(6px)", transition: {duration: 0.25}}}
                 transition={spring}>
      {node}
    </motion.span>
  );

  const parts: React.ReactNode[] = [];
  if (stage <= 1) {
    parts.push(piece("coin", <Relic src={RELIC.coinFull} size={size} />, {}));
    if (stage === 1) parts.push(piece("cut", <span className="cargo-cut" style={{width: size * 1.3}} />, {}));
  } else if (stage <= 3) {
    parts.push(piece("floor", <Relic src={RELIC.coinFloor} size={half} />, {x: -size * 0.42, y: 2}, stage === 3 ? "endings-a" : ""));
    parts.push(piece("upside", <Relic src={RELIC.coinUp} size={half} />, {x: size * 0.42, y: -4}, stage === 3 ? "endings-b" : ""));
  } else if (stage === 4) {
    parts.push(piece("stele", <Relic src={RELIC.stele} size={size} />, {}));
  } else if (stage === 5) {
    parts.push(piece("sun", <SunAnim size={size} />, {}));
  } else if (stage === 6) {
    parts.push(piece("scales", <Relic src={RELIC.scales} size={size} />, {}, "rocking"));
  } else {
    parts.push(piece("floor", <Relic src={RELIC.coinFloor} size={half} />, {x: -size * 0.42}, "sinking"));
    parts.push(piece("upside", <Relic src={RELIC.coinUp} size={half} />, {x: size * 0.42}, "fading"));
  }

  return (
    <div className="cargo" style={{width: size * 2, height: size}} aria-hidden>
      <AnimatePresence mode="popLayout">{parts}</AnimatePresence>
    </div>
  );
}
