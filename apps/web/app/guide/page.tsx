"use client";
import Link from "next/link";
import { ContactLinks } from "@/components/Help";
import { isTestChain, support } from "@/env";
import { useI18n } from "@/i18n/I18nProvider";

/** Beginner guide: wallet, USDT on BSC, BNB for fees, eligibility, subscribing. Anchors are linked from hints elsewhere. */
export default function Guide() {
  const { t } = useI18n();
  const h = t.help;
  return (
    <section>
      <div className="wrap">
        <div className="sec-h">
          <h1 className="h2">{h.guideTitle}</h1>
          <p>{h.guideIntro}</p>
        </div>
        {isTestChain && <p className="helpbox" style={{ marginBottom: 18 }}>{h.testnetNote}</p>}
        <ol className="guide">
          {h.steps.map((s) => (
            <li key={s.id} id={s.id} className="panel">
              <h2 className="h3">{s.title}</h2>
              <ul>{s.body.map((x) => <li key={x}>{x}</li>)}</ul>
            </li>
          ))}
        </ol>
        <p className="row-actions" style={{ marginTop: 20 }}>
          <Link className="btn primary" href="/projects">{h.start}</Link>
          <Link className="btn ghost" href="/faq">{h.faqLink}</Link>
        </p>
        {(support.telegram || support.email) && (
          <p className="muted" style={{ marginTop: 14 }}>{h.contactText} <ContactLinks /></p>
        )}
      </div>
    </section>
  );
}
