"use client";

import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";

// ── Simple / Terminal ──────────────────────────────────────────────────────────────────────────

type View = "simple" | "terminal";
type Theme = "basalt" | "limestone";

type Prefs = {view: View; setView: (v: View) => void; theme: Theme; setTheme: (t: Theme) => void};
const PrefsCtx = createContext<Prefs>({view: "simple", setView: () => {}, theme: "basalt", setTheme: () => {}});

function read<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && ok.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* private mode: the choice just isn't remembered */ }
}

export function PrefsProvider({children}: {children: React.ReactNode}) {
  const [view, setViewState] = useState<View>("simple");
  const [theme, setThemeState] = useState<Theme>("basalt");

  useEffect(() => {
    setViewState(read("aarka.view", ["simple", "terminal"] as const, "simple"));
    setThemeState(read("aarka.theme", ["basalt", "limestone"] as const, "basalt"));
  }, []);

  const setView = useCallback((v: View) => { setViewState(v); write("aarka.view", v); }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    write("aarka.theme", t);
    document.documentElement.dataset.theme = t;
  }, []);

  const value = useMemo(() => ({view, setView, theme, setTheme}), [view, setView, theme, setTheme]);
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}

export const usePrefs = () => useContext(PrefsCtx);

// ── Toasts ─────────────────────────────────────────────────────────────────────────────────────

type Tone = "up" | "down" | "accent" | "lapis";
type Toast = {id: number; title: string; body?: React.ReactNode; tone: Tone};
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({children}: {children: React.ReactNode}) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), {...t, id}]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 6500);
  }, []);
  const colour: Record<Tone, string> = {up: "var(--up)", down: "var(--down)", accent: "var(--accent)", lapis: "var(--lapis)"};

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role="status" className="toast" style={{"--tc": colour[t.tone]} as React.CSSProperties}>
            <span className="bar" />
            <div className="txt"><strong>{t.title}</strong>{t.body && <span>{t.body}</span>}</div>
            <button className="x" aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ── Motion helpers ─────────────────────────────────────────────────────────────────────────────

export function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

/** Pointer-following light for `.spot` cards. */
export const spot = {
  onMouseMove(e: React.MouseEvent<HTMLElement>) {
    const el = e.currentTarget, r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    el.style.setProperty("--o", "1");
  },
  onMouseLeave(e: React.MouseEvent<HTMLElement>) {
    e.currentTarget.style.setProperty("--o", "0");
  },
};
