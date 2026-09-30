"use client";

import {useEffect, useRef} from "react";
import Lenis from "lenis";
import {motion, useMotionValue, useSpring, type Variants} from "motion/react";
import {useReducedMotion} from "@/lib/ui";

/**
 * The motion vocabulary, in one place. Every piece honours reduced motion by rendering its final
 * state immediately, so nothing a reader needs is ever behind an animation.
 */

/** Momentum scrolling for the page, so the scroll-driven story moves like film rather than steps. */
export function SmoothScroll() {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({lerp: 0.11, wheelMultiplier: 0.9});
    let raf = 0;
    const tick = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    // In-page anchors glide instead of jumping.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href^='#']") as HTMLAnchorElement | null;
      if (!a) return;
      const el = document.querySelector(a.getAttribute("href")!);
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el as HTMLElement, {offset: -24, duration: 1.4});
    };
    document.addEventListener("click", onClick);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); document.removeEventListener("click", onClick); };
  }, [reduce]);
  return null;
}

const word: Variants = {
  hidden: {opacity: 0, y: "0.45em", filter: "blur(10px)"},
  show: (i: number) => ({opacity: 1, y: 0, filter: "blur(0px)", transition: {delay: i * 0.055, duration: 0.7, ease: [0.2, 0.7, 0.2, 1]}}),
};

/**
 * A headline that arrives one word at a time. Children may mix text and elements; text is split
 * into words, and each element is treated as one word so an emphasis span stays whole.
 */
export function WordReveal({children, as = "h2", className, once = true}: {
  children: React.ReactNode; as?: "h1" | "h2" | "h3" | "p"; className?: string; once?: boolean;
}) {
  const reduce = useReducedMotion();
  const parts: React.ReactNode[] = [];
  const push = (n: React.ReactNode) => {
    if (typeof n === "string") n.split(/(\s+)/).forEach((w) => w && parts.push(w));
    else parts.push(n);
  };
  (Array.isArray(children) ? children : [children]).forEach(push);
  const Tag = motion[as];
  let i = 0;
  return (
    <Tag className={className} initial={reduce ? "show" : "hidden"} whileInView="show" viewport={{once, margin: "0px 0px -12% 0px"}}>
      {parts.map((p, k) =>
        typeof p === "string" && /^\s+$/.test(p) ? p : (
          <motion.span key={k} custom={i++} variants={word} style={{display: "inline-block", whiteSpace: "pre"}}>{p}</motion.span>
        ),
      )}
    </Tag>
  );
}

/** Rises and fades in when it scrolls into view. */
export function Rise({children, delay = 0, className, style, as = "div"}: {
  children: React.ReactNode; delay?: number; className?: string; style?: React.CSSProperties; as?: "div" | "section" | "article" | "li";
}) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag className={className} style={style}
         initial={reduce ? false : {opacity: 0, y: 36}} whileInView={{opacity: 1, y: 0}}
         viewport={{once: true, margin: "0px 0px -10% 0px"}}
         transition={{duration: 0.8, delay: delay / 1000, ease: [0.2, 0.7, 0.2, 1]}}>
      {children}
    </Tag>
  );
}

/** A button that leans toward the pointer, and settles back on a spring. */
export function Magnetic({children, strength = 0.28, className}: {children: React.ReactNode; strength?: number; className?: string}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0), y = useMotionValue(0);
  const sx = useSpring(x, {stiffness: 220, damping: 18, mass: 0.4});
  const sy = useSpring(y, {stiffness: 220, damping: 18, mass: 0.4});
  return (
    <motion.span ref={ref} className={className} style={{display: "inline-flex", x: sx, y: sy}}
      onPointerMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}>
      {children}
    </motion.span>
  );
}

/** Segmented choices with a pill that slides between them. */
export function Pills<T extends string>({value, onChange, options, id, className}: {
  value: T; onChange: (v: T) => void; options: {value: T; label: React.ReactNode; sub?: React.ReactNode}[]; id: string; className?: string;
}) {
  return (
    <div role="radiogroup" className={`pills ${className ?? ""}`}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className="pill" onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`pill-${id}`} className="pill-bg" transition={{type: "spring", stiffness: 420, damping: 34}} />}
          <span className="pill-txt">{o.label}{o.sub && <span className="pill-sub">{o.sub}</span>}</span>
        </button>
      ))}
    </div>
  );
}
