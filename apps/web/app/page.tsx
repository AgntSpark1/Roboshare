"use client";
import Link from "next/link";
import { useState } from "react";
import { DEFAULT_TIERS, allocate } from "@roboshare/shared";
import { formatBps, formatUsdt } from "@roboshare/ui";
import { Hero } from "@/components/Hero";
import { ProjectCard } from "@/components/ProjectCard";
import { useI18n } from "@/i18n/I18nProvider";
import { useProjects } from "@/lib/data";

const SAMPLE_D = 880n * 10n ** 18n; // illustrative distributable profit for the calculator only

export default function Home() {
  const { t } = useI18n();
  const h = t.home;
  const projects = useProjects();
  const items = projects.data?.items ?? [];
  const featured = items.find((p) => p.state === "OFFERING");
  return (
    <>
      <Hero featured={featured} />

      <section>
        <div className="wrap">
          <div className="sec-h">
            <h2>{h.offering}</h2>
            <Link className="btn sm ghost" href="/projects">{h.allProjects}</Link>
          </div>
          {projects.isLoading ? (
            <p className="muted">{h.loading}</p>
          ) : projects.error ? (
            <p className="err" role="alert">{h.loadError}</p>
          ) : items.length === 0 ? (
            <div className="panel empty"><p className="muted">{h.comingSoon}</p></div>
          ) : (
            <div className="grid">{items.filter((p) => p.state !== "CANCELLED").slice(0, 3).map((p) => <ProjectCard key={p.id} p={p} />)}</div>
          )}
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-h"><h2>{h.stepsTitle}</h2></div>
          <div className="steps">
            {h.steps.map(([title, text]) => (
              <div className="step" key={title}><div className="bar" /><h3>{title}</h3><p>{text}</p></div>
            ))}
          </div>
        </div>
      </section>

      <TierCalculator />

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-h"><h2>{h.trustTitle}</h2></div>
          <div className="trust">
            <div>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z" /><path d="M9 12l2 2 4-4" /></svg>
              <h3>{h.trust[0]![0]}</h3>
              <p>{h.trust[0]![1]}</p>
            </div>
            <div>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 13h5M10 17h5" /></svg>
              <h3>{h.trust[1]![0]}</h3>
              <p>{h.trust[1]![1]}</p>
            </div>
            <div>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
              <h3>{h.trust[2]![0]}</h3>
              <p>{h.trust[2]![1]}</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function TierCalculator() {
  const { t } = useI18n();
  const h = t.home;
  const [units, setUnits] = useState(12);
  const r = allocate(SAMPLE_D, 0n, [{ address: "you", units }, ...(units < 100 ? [{ address: "others", units: 100 - units }] : [])]);
  const mine = r.allocations.find((a) => a.address === "you")!;
  const fee = mine.gross - mine.net;
  const bps = mine.feeBps;
  const pct = (x: bigint) => (mine.gross === 0n ? 0 : Number((x * 10000n) / mine.gross) / 100);
  return (
    <section style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="sec-h">
          <h2>{h.calcTitle}</h2>
          <p>{h.calcIntro}</p>
        </div>
        <div className="tiers">
          <div className="tier-rows">
            {DEFAULT_TIERS.map((tier, i) => {
              const next = DEFAULT_TIERS[i + 1];
              const on = units >= tier.minUnits && (!next || units < next.minUnits);
              return (
                <div key={tier.minUnits} className={`tier-row${on ? " on" : ""}`}>
                  <span className="u">{t.units.range(tier.minUnits, next ? next.minUnits - 1 : 100)}</span>
                  <span className="b"><i style={{ width: `${(tier.bps / 2000) * 100}%` }} /></span>
                  <span className="p">{formatBps(tier.bps)}</span>
                </div>
              );
            })}
          </div>
          <div className="calc">
            <div className="line"><span className="muted">{h.calcUnits}</span><b>{t.units.n(units)}</b></div>
            <input type="range" min={1} max={100} value={units} aria-label={h.calcUnits} onChange={(e) => setUnits(Number(e.target.value))} />
            <div className="line"><span className="muted">{h.calcProfit}</span><b>{formatUsdt(SAMPLE_D)} USDT</b></div>
            <div className="split" aria-hidden="true">
              <i style={{ background: "var(--amber)", width: `${pct(mine.net)}%` }} />
              <i style={{ background: "var(--lidar)", width: `${pct(fee)}%` }} />
            </div>
            <div className="legend"><span style={{ ["--c" as string]: "var(--amber)" }}>{h.calcYou}</span><span style={{ ["--c" as string]: "var(--lidar)" }}>{h.calcFee}</span></div>
            <div className="line"><span className="muted">{h.calcGross}</span><b>{formatUsdt(mine.gross)} USDT</b></div>
            <div className="line"><span className="muted">{h.calcFee}</span><b>− {formatUsdt(fee)} USDT({formatBps(bps)})</b></div>
            <div className="line total"><span>{h.calcYou}</span><b>{formatUsdt(mine.net)} USDT</b></div>
            <p className="fine">{h.calcNote}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
