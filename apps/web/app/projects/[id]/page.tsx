"use client";
import Link from "next/link";
import { use } from "react";
import { formatBps, formatDate, formatUsdt, OfferingProgress, shortAddr, StatePill, stateLabel, type DailyRevenueItem } from "@roboshare/ui";
import { CarArt } from "@/components/CarArt";
import { projectCode } from "@/components/ProjectCard";
import { MarketPanel } from "@/components/MarketPanel";
import { SubscribePanel } from "@/components/SubscribePanel";
import { explorer } from "@/env";
import { useI18n } from "@/i18n/I18nProvider";
import { useDailyRevenue, useFinancials, useProject, useProjectDistributions } from "@/lib/data";
import { termLine } from "@/lib/term";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const c = t.project;
  const q = useProject(id);
  const fin = useFinancials(id);
  const dist = useProjectDistributions(id);
  const daily = useDailyRevenue(id);

  if (q.isLoading) return <section><div className="wrap"><p className="muted">{c.loading}</p></div></section>;
  if (q.error || !q.data)
    return (
      <section>
        <div className="wrap">
          <p className="err" role="alert">{c.notFound}</p>
          <Link className="btn ghost" href="/projects">{c.back}</Link>
        </div>
      </section>
    );
  const p = q.data;
  const code = projectCode({ slug: p.meta?.slug ?? null, id: p.id });
  const o = p.offering;
  const term = termLine(p.term, t.projects.term);
  const link = (kind: "address" | "tx", v: string | null) =>
    v ? (explorer ? <a className="hash" href={`${explorer}/${kind}/${v}`} target="_blank" rel="noreferrer">{shortAddr(v, 8, 6)}</a> : <span className="hash">{shortAddr(v, 8, 6)}</span>) : "—";

  return (
    <section>
      <div className="wrap">
        <nav className="crumb" aria-label={c.crumb}><Link href="/projects">{t.nav.projects}</Link> / {code}</nav>
        <div className="dhead">
          <div>
            <div className="dart">
              <CarArt id={p.id} code={code} />
              <span className="tag">{c.artTag}</span>
            </div>
            <div className="title-row">
              <h1>{p.meta?.title ?? code}</h1>
              <StatePill state={p.state} />
            </div>
            <p className="muted">{p.meta?.summary ?? c.noSummary}</p>
            {term && <p className="term-line" data-testid="term-line" style={{ marginTop: 8 }}>{term}</p>}
            <div className="facts">
              <div><span>{c.model}</span><b>{[p.meta?.make, p.meta?.model].filter(Boolean).join(" ") || "—"}</b></div>
              <div><span>{c.issuedCap}</span><b>{t.units.of(p.issuedUnits, p.authorizedUnits)}</b></div>
              <div><span>{c.rightType}</span><b>{c.rightTypeValue}</b></div>
              <div><span>{c.currency}</span><b>USDT</b></div>
            </div>
            {o && p.state === "OFFERING" && (
              <div className="panel" style={{ marginTop: 18 }}>
                <h2 className="h3">{c.progress}</h2>
                <OfferingProgress sold={o.unitsSold} min={o.minUnits} max={o.maxUnits} />
                <p className="muted" style={{ fontSize: ".8rem", marginTop: 10 }}>
                  {c.offeringNote(formatDate(o.endAt), o.minUnits)}
                </p>
              </div>
            )}
          </div>
          {o && p.state === "OFFERING" ? (
            <SubscribePanel p={p} />
          ) : (
            <aside className="buy" aria-label={c.statusAria}>
              <div className="line"><span className="muted">{c.currentState}</span><b>{stateLabel(p.state, t.ui.states)}</b></div>
              <p className="muted" style={{ fontSize: ".84rem" }}>
                {p.state === "ACTIVE" ? c.activeNote : c.closedNote}
              </p>
              {(p.state === "FUNDED" || p.state === "ACTIVE") && <Link className="btn primary" href={`/market?project=${p.id}`}>{t.p2p.goMarket}</Link>}
              <Link className="btn ghost" href="/portfolio">{c.viewPortfolio}</Link>
            </aside>
          )}
        </div>

        {daily.data?.items.length ? <DailyPanel items={daily.data.items} /> : null}

        {(p.state === "FUNDED" || p.state === "ACTIVE") && <MarketPanel p={p} />}

        <div className="cols2" style={{ marginTop: 24 }}>
          <div className="panel">
            <h2 className="h3">{c.reports}</h2>
            {fin.data?.items.length ? (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">{c.reports}</caption>
                  <thead><tr><th>{c.period}</th><th className="r">{c.revenue}</th><th className="r">{c.distributable}</th></tr></thead>
                  <tbody>
                    {fin.data.items.map((f) => (
                      <tr key={f.recordId}>
                        <td>{formatDate(f.periodStart).slice(0, 10)} – {formatDate(f.periodEnd).slice(0, 10)}</td>
                        <td className="r">{f.grossRevenue ? formatUsdt(f.grossRevenue) : "—"}</td>
                        <td className="r">{formatUsdt(f.distributableAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">{c.reportsEmpty}</p>
            )}
            <p className="fine" style={{ marginTop: 10 }}>{c.reportsNote}</p>
          </div>
          <div className="panel">
            <h2 className="h3">{c.distributions}</h2>
            {dist.data?.items.length ? (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">{c.distributions}</caption>
                  <thead><tr><th>{c.round}</th><th className="r">{c.amountUsdt}</th></tr></thead>
                  <tbody>
                    {dist.data.items.map((b) => (
                      <tr key={b.batchId}>
                        <td>{c.roundN(b.batchId)}{b.capitalReturn && <span className="tag-s ok-t">{c.capitalReturn}</span>}</td>
                        <td className="r">{formatUsdt(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">{c.distEmpty}</p>
            )}
            <p className="fine" style={{ marginTop: 10 }}>
              {c.feeLine(p.feeTiers.map((x) => c.feeTier(x.minUnits, formatBps(x.bps))).join(" · "))}
            </p>
          </div>
        </div>

        <details className="chain-info">
          <summary>{c.chainInfo}</summary>
          <div className="cols2" style={{ marginTop: 8 }}>
            <div className="panel">
              <h2 className="h3">{c.contracts}</h2>
              <div className="health">
                <div><span>{c.token}</span>{link("address", p.contracts.token)}</div>
                <div><span>{c.offeringContract}</span>{link("address", p.contracts.offering)}</div>
                <div><span>{c.distributor}</span>{link("address", p.contracts.distributor)}</div>
              </div>
            </div>
            <div className="panel">
              <h2 className="h3">{c.history}</h2>
              <div className="timeline">
                {p.stateHistory.map((s) => (
                  <div className="tl" key={s.chain.txHash + s.to}>
                    <i aria-hidden="true" />
                    <span>{stateLabel(s.to, t.ui.states)}</span>
                    <span>{link("tx", s.chain.txHash)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}

function DailyPanel({ items }: { items: DailyRevenueItem[] }) {
  const c = useI18n().t.project;
  const today = items[0]!;
  const pending = (s: DailyRevenueItem["status"]) => (s === "PENDING" ? <span className="tag-s warn-t">{c.daily.pending}</span> : null);
  return (
    <div className="panel" style={{ marginTop: 24 }} data-testid="daily-revenue">
      <h2 className="h3">{c.daily.title}</h2>
      <div className="daily-today">
        <span className="muted">{c.daily.today} · {today.day}</span>
        <b className="num">{formatUsdt(today.net)} USDT</b>
        {pending(today.status)}
      </div>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">{c.daily.recent}</caption>
          <thead><tr><th>{c.daily.date}</th><th className="r">{c.daily.income}</th><th className="r">{c.daily.rides}</th></tr></thead>
          <tbody>
            {items.slice(0, 7).map((d) => (
              <tr key={d.day}>
                <td>{d.day}{pending(d.status)}</td>
                <td className="r">{formatUsdt(d.net)}</td>
                <td className="r">{d.rides ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
