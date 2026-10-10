"use client";

import {Fragment, useEffect, useRef, useState} from "react";
import {useReducedMotion} from "@/lib/ui";

/**
 * Writing on clay.
 *
 *   LiveInscription   a sentence that follows the inputs. When it changes, only what changed is
 *                     rubbed out and rewritten: the shared start stays, so a new amount at the end
 *                     of the sentence never retypes the beginning.
 *   Seg               a run of text, or a whole node (a term) with the text it reads as.
 *
 * Numbers are inked in gold. With reduced motion, everything is simply there.
 */

const GOLD = /(\$[\d,]+(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\b)/g;

function inked(text: string) {
  return text.split(GOLD).map((part, i) => (i % 2 ? <b key={i} className="ink-gold">{part}</b> : <Fragment key={i}>{part}</Fragment>));
}

export function LiveInscription({text, className}: {text: string; className?: string}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(text);
  const target = useRef(text);
  target.current = text;
  const typing = shown !== text;

  useEffect(() => {
    if (reduce) { setShown(text); return; }
    if (shown === text) return;
    // Rub out until what's left is the start of the new sentence, then write the rest.
    const back = !text.startsWith(shown);
    const t = setTimeout(() => {
      setShown((s) => {
        const goal = target.current;
        if (!goal.startsWith(s)) return s.slice(0, -1);
        return goal.slice(0, s.length + 1);
      });
    }, back ? 7 : 15);
    return () => clearTimeout(t);
  }, [shown, text, reduce]);

  return (
    <p className={`inscription${className ? ` ${className}` : ""}`} aria-live="polite" aria-atomic="true">
      <span className="sr-only">{text}</span>
      <span aria-hidden>{inked(shown)}<span className={`stylus${typing ? " busy" : ""}`} /></span>
    </p>
  );
}

export type Seg = string | {node: React.ReactNode; text: string};
