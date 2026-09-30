"use client";

import {useRouter} from "next/navigation";
import {useEffect} from "react";

/** F1, F2 and F3 go where the menu says they go. Not while typing in a field. */
const KEYS: Record<string, string> = {F1: "/", F2: "/app", F3: "/how"};

export function Keys() {
  const router = useRouter();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const to = KEYS[e.key];
      if (!to || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      if (location.pathname !== to) router.push(to);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [router]);
  return null;
}
