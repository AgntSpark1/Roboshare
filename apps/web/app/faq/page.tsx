"use client";
import Link from "next/link";
import { ContactLinks } from "@/components/Help";
import { support } from "@/env";
import { useI18n } from "@/i18n/I18nProvider";

export default function Faq() {
  const { t } = useI18n();
  const h = t.help;
  return (
    <section>
      <div className="wrap">
        <div className="sec-h">
          <h1 className="h2">{h.faqTitle}</h1>
          <p>{h.faqIntro}</p>
        </div>
        <div className="risk-list faq">
          {h.faq.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
        <p className="row-actions" style={{ marginTop: 20 }}>
          <Link className="btn ghost" href="/guide">{h.guideLink}</Link>
          <Link className="btn ghost" href="/risk">{t.layout.investorNotes}</Link>
        </p>
        {(support.telegram || support.email) && (
          <p className="muted" style={{ marginTop: 14 }}>{h.contactText} <ContactLinks /></p>
        )}
      </div>
    </section>
  );
}
