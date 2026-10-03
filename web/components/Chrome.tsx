"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {useAccount, useConnect, useDisconnect, useSwitchChain} from "wagmi";
import {robinhoodTestnet} from "@/lib/chain";
import {short} from "@/lib/format";
import {explorerAddr} from "@/lib/tx";
import {usePrefs} from "@/lib/ui";
import {Keys} from "./Keys";
import {TeleportLink} from "./Teleport";
import {Mark} from "./Mark";

/** Two places, not eleven: the app, and how it works. Everything else lives inside one of them. */
const NAV = [
  {href: "/", label: "Home", key: "F1"},
  {href: "/app", label: "App", key: "F2"},
  {href: "/how", label: "How it works", key: "F3"},
];

function activeIndex(path: string) {
  if (path === "/") return 0;
  if (path.startsWith("/app") || path.startsWith("/split")) return 1;
  if (path.startsWith("/how")) return 2;
  return -1;
}

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The nav slab: an ochre key slides under the current page, a ghost follows the pointer. */
function NavSlab() {
  const path = usePathname();
  const cur = activeIndex(path);
  const ref = useRef<HTMLElement>(null);
  const [m, setM] = useState<{x: number; w: number}[]>([]);
  const [hov, setHov] = useState<number | null>(null);

  const measure = useCallback(() => {
    if (!ref.current) return;
    setM(Array.from(ref.current.querySelectorAll<HTMLElement>("a")).map((el) => ({x: el.offsetLeft, w: el.offsetWidth})));
  }, []);
  // Web fonts land after first paint and change every key's width, so watch the keys themselves.
  useIsoLayout(() => {
    measure();
    document.fonts?.ready.then(measure);
    if (typeof ResizeObserver === "undefined" || !ref.current) return;
    const ro = new ResizeObserver(measure);
    ref.current.querySelectorAll("a").forEach((a) => ro.observe(a));
    return () => ro.disconnect();
  }, [measure]);

  const A = m[cur] ?? {x: 0, w: 0};
  const H = hov != null ? m[hov] ?? A : A;
  return (
    <nav ref={ref} aria-label="Main" className="navslab" onMouseLeave={() => setHov(null)}>
      <span aria-hidden className="ghost" style={{left: H.x, width: H.w, opacity: hov != null && hov !== cur ? 1 : 0}} />
      <span aria-hidden className="slab" style={{left: A.x, width: A.w, opacity: m.length && cur >= 0 ? 1 : 0}} />
      {NAV.map((n, i) => (
        <TeleportLink key={n.href} href={n.href} aria-current={i === cur ? "page" : undefined}
              onMouseEnter={() => setHov(i)} onFocus={() => setHov(i)}>
          {n.label}
        </TeleportLink>
      ))}
    </nav>
  );
}

function ViewSwitch() {
  const {view, setView} = usePrefs();
  return (
    <>
    <button className="view-pill" aria-label={`View: ${view === "simple" ? "simple" : "pro"}. Switch view`} onClick={() => setView(view === "simple" ? "terminal" : "simple")}>
      {view === "simple" ? "SIMPLE" : "PRO"} ⇄
    </button>
    <div role="group" aria-label="View" className="seg view" style={{gridAutoColumns: "minmax(0, 1fr)"}}>
      <span aria-hidden className="knob" style={{width: "calc(50% - 4px)", transform: view === "terminal" ? "translateX(100%)" : "none"}} />
      <button aria-pressed={view === "simple"} onClick={() => setView("simple")}>SIMPLE</button>
      <button aria-pressed={view === "terminal"} onClick={() => setView("terminal")}>PRO</button>
    </div>
    </>
  );
}

export function WalletButton({compact}: {compact?: boolean}) {
  const {address, isConnected, chainId} = useAccount();
  const {connect, connectors, isPending} = useConnect();
  const {disconnect} = useDisconnect();
  const {switchChain} = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!isConnected) {
    const c = connectors[0];
    return (
      <button className="wallet-btn" disabled={!c || isPending} onClick={() => c && connect({connector: c})}>
        {isPending ? "Connecting…" : !c ? "No wallet found" : compact ? "Connect" : "Connect wallet"}
      </button>
    );
  }
  if (chainId !== robinhoodTestnet.id) {
    return (
      <button className="wallet-btn wrong" onClick={() => switchChain({chainId: robinhoodTestnet.id})}>
        {compact ? "Switch" : "Wrong network · switch"}
      </button>
    );
  }
  return (
    <div ref={box} style={{position: "relative"}}>
      <button className="wallet-btn connected" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="dot" />{short(address)}<span className="muted">▾</span>
      </button>
      {open && (
        <div role="menu" className="wallet-menu">
          <button role="menuitem" onClick={() => {
            navigator.clipboard?.writeText(address!).catch(() => {});
            setCopied(true); setTimeout(() => setCopied(false), 1500);
          }}>
            Copy address <span className="mono muted" style={{fontSize: 12}}>{copied ? "COPIED" : short(address)}</span>
          </button>
          <Link role="menuitem" href="/app#positions" onClick={() => setOpen(false)}>What I hold <span className="mono gold">F2</span></Link>
          <a role="menuitem" href={explorerAddr(address!)} target="_blank" rel="noreferrer">View on explorer <span>↗</span></a>
          <button role="menuitem" onClick={() => { disconnect(); setOpen(false); }}>Disconnect</button>
        </div>
      )}
    </div>
  );
}

export function SiteHeader({overlay}: {overlay?: boolean}) {
  // Simple and Pro only change the app and the split pages, so the switch only shows there.
  const path = usePathname();
  const trades = path.startsWith("/app") || path.startsWith("/split");
  return (
    <header className={`site-head${overlay ? " overlay" : ""}`}>
      <a href="#main" className="skip">Skip to content</a>
      <Link href="/" aria-label="Aarka home" className="brand">
        <Mark size={36} ground={overlay ? "var(--bg)" : "var(--bg)"} />
        <span className="word">AARKA</span>
      </Link>
      <NavSlab />
      <Keys />
      <TabBar />
      <div className="head-tools">
        {trades && <ViewSwitch />}
        <WalletButton />
      </div>
    </header>
  );
}

/** On a phone the top menu doesn't fit, so the same three places sit at the bottom, in thumb reach. */
const TAB_ICONS: Record<string, string> = {
  "/": "M2 7h1v6H2zM3 6h1v1H3zM4 5h1v1H4zM5 4h1v1H5zM6 3h2v1H6zM8 4h1v1H8zM9 5h1v1H9zM10 6h1v1h-1zM11 7h1v6h-1zM3 12h8v1H3zM6 9h2v3H6z",
  "/app": "M4 2h6v1H4zM3 3h1v1H3zM10 3h1v1h-1zM2 4h1v6H2zM11 4h1v6h-1zM3 10h1v1H3zM10 10h1v1h-1zM4 11h6v1H4zM6 4h1v7H6zM7 5h2v1H7zM7 7h2v1H7z",
  "/how": "M3 2h8v1H3zM2 3h1v9H2zM11 3h1v9h-1zM3 12h8v1H3zM4 5h6v1H4zM4 7h6v1H4zM4 9h4v1H4z",
};

function TabBar() {
  const path = usePathname();
  const cur = activeIndex(path);
  return (
    <nav className="tabbar" aria-label="Main">
      {NAV.map((n, i) => (
        <TeleportLink key={n.href} href={n.href} aria-current={i === cur ? "page" : undefined}>
          <svg viewBox="0 0 14 14" width="22" height="22" shapeRendering="crispEdges" aria-hidden><path fill="currentColor" d={TAB_ICONS[n.href]} /></svg>
          <span>{n.label}</span>
        </TeleportLink>
      ))}
    </nav>
  );
}

function FootCompact() {
  return (
    <footer className="foot">
      <Mark size={24} ground="var(--bg-strip)" />
      <span className="ml-auto">TESTNET · PRACTICE SHARES HAVE NO CASH VALUE · © 2026 AARKA</span>
    </footer>
  );
}

export function FootFull() {
  return (
    <footer className="foot-full">
      <div className="foot-links">
        <Mark size={24} ground="var(--bg-strip)" />
        <Link href="/app">App</Link><Link href="/app#positions">Your positions</Link><Link href="/how">How it works</Link>
        <a href="https://github.com/Madhav-Gupta-28/Aarka" target="_blank" rel="noreferrer">GitHub ↗</a>
        <span className="ml-auto muted">TESTNET · © 2026 AARKA</span>
      </div>
    </footer>
  );
}

/** The frame every regular page shares. */
export function Shell({children, full, overlayHead}: {
  children: React.ReactNode; full?: boolean; overlayHead?: boolean;
}) {
  return (
    <div className="page">
      <SiteHeader overlay={overlayHead} />
      <main id="main">{children}</main>
      {full ? <FootFull /> : <FootCompact />}
    </div>
  );
}
