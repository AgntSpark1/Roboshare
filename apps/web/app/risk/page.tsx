"use client";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";

/** Investor notes. Draft wording for counsel review; each project's rights document and offering terms prevail. */
export default function Risk() {
  const { t } = useI18n();
  const r = t.risk;
  return (
    <section>
      <div className="wrap">
        <div className="sec-h">
          <h1 className="h2">{r.title}</h1>
          <p>{r.intro}</p>
        </div>
        <div className="trust" style={{ marginBottom: 24 }}>
          {r.safeguards.map(([h, x]) => (
            <div key={h}>
              <h3>{h}</h3>
              <p>{x}</p>
            </div>
          ))}
        </div>
        <h2 className="h3">{r.risksTitle}</h2>
        <p className="muted" style={{ marginBottom: 12 }}>{r.mayLose}</p>
        <div className="risk-list">
          {r.risks.map(([h, l]) => (
            <details key={h}>
              <summary>{h}</summary>
              <ul>{l.map((x) => <li key={x}>{x}</li>)}</ul>
            </details>
          ))}
        </div>
        {r.translationNote && <p className="fine" style={{ marginTop: 14 }}>{r.translationNote}</p>}
        <p style={{ marginTop: 18 }}>
          <Link className="btn ghost" href="/projects">{r.viewProjects}</Link>
        </p>
      </div>
    </section>
  );
}
