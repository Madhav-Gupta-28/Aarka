"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {Mark} from "./Mark";
import {Connect} from "./Connect";
import {robinhoodTestnet} from "@/lib/chain";

const LINKS = [
  {href: "/markets", label: "Markets"},
  {href: "/portfolio", label: "Portfolio"},
  {href: "/settle", label: "Settlement"},
  {href: "/parity", label: "Parity"},
  {href: "/faucet", label: "Faucet"},
  {href: "/docs", label: "Docs"},
];

export function Nav() {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <header className="nav">
      <div className="navInner">
        <Link href="/" className="navBrand">
          <Mark size={26} />
          <span>Aarka</span>
        </Link>

        <nav className="navLinks" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={active(l.href) ? "on" : ""}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="navRight">
          <span className="net" title={robinhoodTestnet.name}>
            <i className="dot" />
            <span className="netLong">Robinhood testnet</span>
            <span className="netShort">Testnet</span>
          </span>
          <Connect />
        </div>
      </div>
    </header>
  );
}
