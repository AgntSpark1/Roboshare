"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Modal, WalletButton } from "@roboshare/ui";
import { walletEnv } from "@/env";
import { useI18n } from "@/i18n/I18nProvider";
import { LOCALES } from "@/i18n/locales";
import type { Messages } from "@/i18n/messages";

const NAV = [
  { href: "/", label: (t: Messages) => t.nav.home, tab: (t: Messages) => t.nav.home, icon: "M4 11l8-7 8 7v9h-5v-6H9v6H4z" },
  { href: "/projects", label: (t: Messages) => t.nav.projects, tab: (t: Messages) => t.nav.tabProjects, icon: "M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16v3H5z" },
  { href: "/portfolio", label: (t: Messages) => t.nav.portfolio, tab: (t: Messages) => t.nav.tabPortfolio, icon: "M3 9h18v10H3zM16 13.5h2M3 6h18" },
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

/** Compact language picker for the top bar: globe and a short code, the full list in a dialog. */
export function LanguageSwitch() {
  const { t, locale, auto, setLocale, setAuto } = useI18n();
  const [open, setOpen] = useState(false);
  const current = LOCALES.find((l) => l.code === locale)!;
  return (
    <>
      <button type="button" className="lang-btn" onClick={() => setOpen(true)} aria-label={`${t.nav.language}: ${current.label}`}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
        </svg>
        <span aria-hidden="true">{current.short}</span>
      </button>
      {open && (
        <Modal title={t.nav.language} onClose={() => setOpen(false)}>
          <div className="lang-list">
            <button
              type="button"
              className={`lang-auto${auto ? " on" : ""}`}
              aria-pressed={auto}
              onClick={() => {
                setAuto();
                setOpen(false);
              }}
            >
              {t.nav.auto}
            </button>
            {LOCALES.map((l) => (
              <button
                key={l.code}
                type="button"
                lang={l.code}
                className={!auto && l.code === locale ? "on" : ""}
                aria-pressed={!auto && l.code === locale}
                onClick={() => {
                  setLocale(l.code);
                  setOpen(false);
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

export function Header() {
  const path = usePathname() ?? "/";
  const { t } = useI18n();
  return (
    <header className="top">
      <div className="wrap">
        <Link className="brand" href="/" aria-label={t.nav.homeAria}>
          <Logo />
          <span>
            RoboShare<small>ROBOTAXI · RWA</small>
          </span>
        </Link>
        <nav className="nav" aria-label={t.nav.main}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={active(path, n.href) ? "on" : ""} aria-current={active(path, n.href) ? "page" : undefined}>
              {n.label(t)}
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        <span className="chip-net">
          <span className="dot" aria-hidden="true" />
          {t.nav.chainNames[walletEnv.chainId] ?? t.nav.network}
        </span>
        <LanguageSwitch />
        <WalletButton compact />
      </div>
    </header>
  );
}

export function Tabs() {
  const path = usePathname() ?? "/";
  const { t } = useI18n();
  return (
    <nav className="tabs" aria-label={t.nav.bottom}>
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} className={active(path, n.href) ? "on" : ""} aria-current={active(path, n.href) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d={n.icon} />
          </svg>
          {n.tab(t)}
        </Link>
      ))}
    </nav>
  );
}
