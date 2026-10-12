"use client";
import Link from "next/link";
import { useState } from "react";
import { ProjectCard } from "@/components/ProjectCard";
import { useI18n } from "@/i18n/I18nProvider";
import { useProjects } from "@/lib/data";
import { useMarketAddress } from "@/lib/market";

const FILTERS = ["all", "OFFERING", "ACTIVE", "FUNDED", "VERIFIED", "CANCELLED"];

export default function Projects() {
  const { t } = useI18n();
  const [filter, setFilter] = useState("all");
  const q = useProjects();
  const market = useMarketAddress();
  const items = (q.data?.items ?? []).filter((p) => filter === "all" || p.state === filter);
  return (
    <section>
      <div className="wrap">
        <div className="sec-h">
          <h1 className="h2">{t.projects.title}</h1>
          <p>{t.projects.intro}</p>
          {market && <Link className="btn sm ghost" href="/market">{t.p2p.homeCta} →</Link>}
        </div>
        <div className="filters" role="group" aria-label={t.projects.filterAria}>
          {FILTERS.map((k) => (
            <button key={k} type="button" className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {t.projects.filters[k]}
            </button>
          ))}
        </div>
        {q.isLoading ? (
          <p className="muted">{t.home.loading}</p>
        ) : q.error ? (
          <p className="err" role="alert">{t.home.loadError}</p>
        ) : items.length === 0 ? (
          <div className="panel empty"><p className="muted">{t.projects.empty}</p></div>
        ) : (
          <div className="grid">{items.map((p) => <ProjectCard key={p.id} p={p} />)}</div>
        )}
      </div>
    </section>
  );
}
