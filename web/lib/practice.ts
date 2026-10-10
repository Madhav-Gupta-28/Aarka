"use client";

import {useSyncExternalStore} from "react";

/**
 * A practice run: the whole flow with pretend balances and nothing sent. What a practice run
 * "bought" lives here, for this tab only, so the shelf can show it and nobody mistakes it for real.
 */

export type PracticePos = {
  id: string;
  sym: string;
  series: string;
  K: number;
  expiry: string;          // unix seconds, as a string so it survives JSON
  half: "floor" | "upside";
  qty: number;             // Floors kept, or Upsides bought
  cash: number;            // cash taken (earn) or paid (bet)
  at: number;
};

/** Pretend balances for a practice run. */
export const PRACTICE = {shares: 10, cash: 1000};

const KEY = "aarka.practice";
let list: PracticePos[] = [];
const subs = new Set<() => void>();
let loaded = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { list = JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); } catch { list = []; }
}
function save() {
  try { sessionStorage.setItem(KEY, JSON.stringify(list)); } catch { /* not kept */ }
  subs.forEach((f) => f());
}

export function addPractice(p: Omit<PracticePos, "id" | "at">) {
  load();
  list = [{...p, id: Math.random().toString(36).slice(2), at: Date.now()}, ...list].slice(0, 8);
  save();
}
export function clearPractice() { load(); list = []; save(); }

const EMPTY: PracticePos[] = [];
export const usePractice = () => useSyncExternalStore(
  (f) => { subs.add(f); return () => subs.delete(f); },
  () => { load(); return list; },
  () => EMPTY,
);
