"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "@roboshare/ui";
import { CHAIN_NAME, walletEnv } from "@/env";

const NAV = [
  { href: "/", label: "首页", icon: "M4 11l8-7 8 7v9h-5v-6H9v6H4z" },
  { href: "/projects", label: "车辆项目", icon: "M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16v3H5z" },
  { href: "/portfolio", label: "我的资产", icon: "M3 9h18v10H3zM16 13.5h2M3 6h18" },
];

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <rect x="1" y="1" width="32" height="32" rx="9" fill="#17223B" stroke="#30406A" />
      <path d="M8 21.5c0-3 1.6-5.6 4-6.6l2.2-3.4h6l2.4 3.4c2.4 1 3.9 3.6 3.9 6.6v1.5H8z" fill="#F6B53D" />
      <circle cx="12.3" cy="23.4" r="2.2" fill="#0A1020" stroke="#F6B53D" strokeWidth="1.4" />
      <circle cx="21.7" cy="23.4" r="2.2" fill="#0A1020" stroke="#F6B53D" strokeWidth="1.4" />
      <circle cx="17" cy="9" r="1.8" fill="#4FE3D2" />
    </svg>
  );
}

export function Header() {
  const path = usePathname() ?? "/";
  return (
    <header className="top">
      <div className="wrap">
        <Link className="brand" href="/" aria-label="RoboShare 首页">
          <Logo />
          <span>
            RoboShare<small>ROBOTAXI · RWA</small>
          </span>
        </Link>
        <nav className="nav" aria-label="主导航">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={active(path, n.href) ? "on" : ""} aria-current={active(path, n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        <span className="chip-net">
          <span className="dot" aria-hidden="true" />
          {CHAIN_NAME[walletEnv.chainId] ?? "网络"}
        </span>
        <WalletButton />
      </div>
    </header>
  );
}

export function Tabs() {
  const path = usePathname() ?? "/";
  return (
    <nav className="tabs" aria-label="底部导航">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} className={active(path, n.href) ? "on" : ""} aria-current={active(path, n.href) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d={n.icon} />
          </svg>
          {n.label.replace("车辆", "").replace("我的", "")}
        </Link>
      ))}
    </nav>
  );
}
