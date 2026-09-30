"use client";

import {useSyncExternalStore} from "react";

/**
 * A few small sounds, made on the spot with Web Audio so nothing is downloaded: a coin's clink
 * when it cracks, a soft rush for a teleport, a two-note chime when something confirms. Off until
 * someone turns it on, and the choice is remembered in this browser.
 */

export type Sound = "clink" | "crack" | "rush" | "chime" | "tick";

const KEY = "aarka.sound";
let on = false;
let ctx: AudioContext | null = null;
const subs = new Set<() => void>();

try { on = typeof window !== "undefined" && localStorage.getItem(KEY) === "on"; } catch { /* private mode */ }

export function setSound(v: boolean) {
  on = v;
  try { localStorage.setItem(KEY, v ? "on" : "off"); } catch { /* not remembered */ }
  subs.forEach((f) => f());
  if (v) play("tick");
}

export const useSound = () => useSyncExternalStore(
  (f) => { subs.add(f); return () => subs.delete(f); },
  () => on,
  () => false,
);

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** A struck metal partial: a sine that starts bright and decays. */
function ping(a: AudioContext, t: number, freq: number, dur: number, gain: number) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Filtered noise, for the crack and the rush. */
function noise(a: AudioContext, t: number, dur: number, gain: number, from: number, to: number, q = 1) {
  const len = Math.ceil(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf;
  f.type = "bandpass";
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export function play(s: Sound) {
  if (!on || typeof window === "undefined") return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches && s === "rush") return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  switch (s) {
    case "clink": // two inharmonic partials, like a coin on stone
      ping(a, t, 2093, 0.5, 0.09); ping(a, t, 3322, 0.32, 0.05); ping(a, t + 0.07, 2637, 0.4, 0.04);
      break;
    case "crack":
      noise(a, t, 0.18, 0.16, 3200, 900, 2); ping(a, t + 0.02, 1760, 0.25, 0.04);
      break;
    case "rush":
      noise(a, t, 0.55, 0.07, 300, 2400, 0.8);
      break;
    case "chime":
      ping(a, t, 1318.5, 0.9, 0.08); ping(a, t + 0.12, 1975.5, 1.1, 0.07);
      break;
    case "tick":
      ping(a, t, 2600, 0.08, 0.05);
      break;
  }
}
