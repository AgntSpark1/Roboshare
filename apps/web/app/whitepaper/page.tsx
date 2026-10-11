"use client";
import { useState } from "react";
import { EDITIONS, PageViewer, defaultEdition, edition, type Edition } from "@/components/Whitepaper";
import { useI18n } from "@/i18n/I18nProvider";

export default function WhitepaperPage() {
  const { t, locale } = useI18n();
  const w = t.whitepaper;
  const [e, setE] = useState<Edition>(() => defaultEdition(locale));
  const [open, setOpen] = useState<number | null>(null);
  const ed = edition(e);
  const pages = Array.from({ length: ed.pages }, (_, i) => i + 1);
  return (
    <section>
      <div className="wrap">
        <div className="wp-hero">
          <button type="button" className="wp-cover" onClick={() => setOpen(1)} aria-label={w.coverAlt}>
            <img src={ed.page(1)} alt={w.coverAlt} width={637} height={900} />
          </button>
          <div className="wp-info">
            <span className="eyebrow">WHITEPAPER</span>
            <h1 className="wp-title">{w.title}</h1>
            <p className="wp-lead">{w.lead}</p>
            <div className="wp-editions" role="group" aria-label={w.edition}>
              {EDITIONS.map((x) => (
                <button key={x.code} type="button" className={x.code === e ? "on" : ""} aria-pressed={x.code === e} onClick={() => setE(x.code)}>
                  {x.label}
                </button>
              ))}
            </div>
            <p className="wp-meta mono">{w.meta(ed.version, ed.pages, ed.mb)} · PDF</p>
            <div className="row-actions">
              <a className="btn primary" href={ed.file} download>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
                {w.download}
              </a>
              <a className="btn ghost" href={ed.file} target="_blank" rel="noopener">{w.read}</a>
            </div>
            {locale !== "zh-CN" && locale !== "en" && <p className="fine">{w.otherLangNote}</p>}
          </div>
        </div>

        <div className="sec-h" style={{ marginTop: 40 }}>
          <h2>{w.preview}</h2>
          <p>{w.previewHint}</p>
        </div>
        <ol className="wp-pages">
          {pages.map((n) => (
            <li key={`${e}-${n}`}>
              <button type="button" onClick={() => setOpen(n)} aria-label={w.pageAlt(n)}>
                <img src={ed.page(n)} alt="" width={637} height={900} loading={n <= 4 ? "eager" : "lazy"} />
                <span className="mono">{String(n).padStart(2, "0")}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="fine" style={{ marginTop: 18 }}>{w.draftNote}</p>
      </div>
      {open !== null && <PageViewer e={e} start={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
