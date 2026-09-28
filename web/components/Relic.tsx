"use client";

import {useEffect, useRef, useState} from "react";
import {RELIC} from "@/lib/relics";
import {useReducedMotion} from "@/lib/ui";

type Name = Exclude<keyof typeof RELIC, "astro" | "sunFrames" | "gears" | "gearsBig">;

/** A pixel relic at a whole-number scale. Decorative unless given alt text. */
export function Relic({name, src, size, alt = "", className, style}: {
  name?: Name; src?: string; size: number; alt?: string; className?: string; style?: React.CSSProperties;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src ?? (RELIC[name!] as string)} width={size} height={size} alt={alt}
         className={`relic${className ? ` ${className}` : ""}`} style={style} />
  );
}

/** Pixel art moves in steps, frame by frame. With reduced motion it holds the first frame. */
export function PixelAnim({frames, size, ms = 160, alt = "", className}: {
  frames: string[]; size: number; ms?: number; alt?: string; className?: string;
}) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((v) => (v + 1) % frames.length), ms);
    return () => clearInterval(t);
  }, [frames.length, ms, reduce]);
  return <Relic src={frames[i]} size={size} alt={alt} className={className} />;
}

export const SunAnim = ({size, alt}: {size: number; alt?: string}) => <PixelAnim frames={RELIC.sunFrames} size={size} ms={180} alt={alt} />;
export const GearAnim = ({size, big}: {size: number; big?: boolean}) => <PixelAnim frames={big ? RELIC.gearsBig : RELIC.gears} size={size} ms={140} />;

/** Fade and rise into place the first time it scrolls into view. */
export function Reveal({children, delay = 0, as: Tag = "div", className = "", style, ...rest}: {
  children: React.ReactNode; delay?: number; as?: React.ElementType; className?: string; style?: React.CSSProperties;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  const [armed, setArmed] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // Only hide what is still below the fold, so nothing already on screen blinks.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setArmed(true);
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeen(true); io.disconnect(); }
    }, {rootMargin: "0px 0px -8% 0px"});
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`${armed ? "reveal" : ""}${seen ? " in" : ""} ${className}`.trim()}
         style={{...style, "--d": `${delay}ms`} as React.CSSProperties} {...rest}>
      {children}
    </Tag>
  );
}
