"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/locales";
import manifest from "@/lib/whitepaper.json";

export type Edition = "zh" | "en";
export const EDITIONS: { code: Edition; label: string }[] = [
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
];

/** Chinese readers get the Chinese edition; everyone else the English one. */
export function defaultEdition(locale: Locale): Edition {
  return locale === "zh-CN" || locale === "zh-TW" ? "zh" : "en";
}

export function edition(e: Edition) {
  const m = manifest[e];
  const pad = String(m.pages).length;
  return {
    ...m,
    version: manifest.version,
    mb: (m.bytes / 1024 / 1024).toFixed(1),
    page: (n: number) => `/whitepaper/pages/${e}/p-${String(n).padStart(pad, "0")}.jpg`,
  };
}

/** Home page band: cover, one line and a link to the full whitepaper page. */
export function WhitepaperBand() {
  const { t, locale } = useI18n();
  const w = t.whitepaper;
  const ed = edition(defaultEdition(locale));
  return (
    <section style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Link href="/whitepaper" className="wp-band">
          <span className="wp-band-cover"><img src={ed.page(1)} alt="" width={637} height={900} loading="lazy" /></span>
          <span className="wp-band-text">
            <span className="eyebrow">WHITEPAPER</span>
            <b>{w.title}</b>
            <span className="muted">{w.homeText}</span>
            <span className="btn sm ghost">{w.homeCta} →</span>
          </span>
        </Link>
      </div>
    </section>
  );
}

/** Full-screen page viewer with previous/next, arrow keys and Escape. */
export function PageViewer({ e, start, onClose }: { e: Edition; start: number; onClose: () => void }) {
  const { t } = useI18n();
  const w = t.whitepaper;
  const ed = edition(e);
  const [n, setN] = useState(start);
  const go = useCallback((d: number) => setN((x) => Math.min(ed.pages, Math.max(1, x + d))), [ed.pages]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
      if (ev.key === "ArrowRight") go(1);
      if (ev.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [go, onClose]);
  return (
    <div className="wp-viewer" role="dialog" aria-modal="true" aria-label={w.title} onClick={onClose}>
      <div className="wp-viewer-bar" onClick={(ev) => ev.stopPropagation()}>
        <span className="mono">{n} / {ed.pages}</span>
        <button type="button" className="btn sm ghost" onClick={onClose} autoFocus>{w.close}</button>
      </div>
      <img src={ed.page(n)} alt={w.pageAlt(n)} onClick={(ev) => ev.stopPropagation()} />
      <div className="wp-viewer-nav" onClick={(ev) => ev.stopPropagation()}>
        <button type="button" className="btn ghost" onClick={() => go(-1)} disabled={n === 1}>← {w.prev}</button>
        <button type="button" className="btn ghost" onClick={() => go(1)} disabled={n === ed.pages}>{w.next} →</button>
      </div>
    </div>
  );
}
