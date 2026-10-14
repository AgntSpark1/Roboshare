"use client";
import Link from "next/link";
import { formatUsdt, OfferingProgress, StatePill, countdown, type ProjectListItem } from "@roboshare/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { termLine } from "@/lib/term";
import { CarArt } from "./CarArt";

export function projectCode(p: { slug: string | null; id: string }) {
  return (p.slug ?? p.id.slice(2, 8)).toUpperCase();
}

export function ProjectCard({ p }: { p: ProjectListItem }) {
  const { t } = useI18n();
  const c = t.projects;
  const code = projectCode(p);
  const o = p.offering;
  const now = Date.now();
  const notStarted = !!o?.startAt && now < new Date(o.startAt).getTime();
  const term = termLine(p.term, c.term);
  return (
    <Link className={`pcard${p.state === "OFFERING" ? " hot" : ""}`} href={`/projects/${p.id}`}>
      <div className="art">
        <CarArt id={p.id} code={code} />
      </div>
      <div className="body">
        <div className="t">
          <div>
            <div className="code">{code}</div>
            <h3>{p.title ?? c.untitled}{p.demo && <span className="tag-s">{t.project.demoTag}</span>}</h3>
          </div>
          <StatePill state={p.state} />
        </div>
        <div className="kv">
          <div>
            <span>{c.unitPrice}</span>
            <b>{o ? `${formatUsdt(o.unitPrice)} USDT` : c.tbd}</b>
          </div>
          <div>
            <span>{c.model}</span>
            <b style={{ fontFamily: "var(--f-body)", fontSize: ".84rem", fontWeight: 500 }}>{[p.make, p.model].filter(Boolean).join(" ") || "—"}</b>
          </div>
        </div>
        {p.state === "OFFERING" && o ? (
          <>
            <OfferingProgress sold={o.unitsSold} min={o.minUnits} max={o.maxUnits} />
            <div className="line">
              <span className="muted">{notStarted ? c.startsIn : c.timeLeft}</span>
              <b className="mono">{countdown(notStarted ? o.startAt! : o.endAt, now, t.ui.days)}</b>
            </div>
          </>
        ) : (
          <div className="line">
            <span className="muted">{c.issued}</span>
            <b>{t.units.of(p.issuedUnits, p.authorizedUnits)}</b>
          </div>
        )}
        {term && <p className="term-line" data-testid="term-line">{term}</p>}
      </div>
    </Link>
  );
}
