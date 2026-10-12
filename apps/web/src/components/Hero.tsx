"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { countdown, formatUsdt, type ProjectListItem } from "@roboshare/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { projectCode } from "./ProjectCard";

/** Renders `*text*` segments of a headline line as highlighted <em>. */
function emphasize(line: string) {
  return line.split("*").map((part, i) => (i % 2 ? <em key={i}>{part}</em> : part));
}

export function Hero({ featured }: { featured?: ProjectListItem }) {
  const { t } = useI18n();
  const h = t.hero;
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stop: (() => void) | undefined;
    let cancelled = false;
    // three.js is loaded only in the browser, after first paint.
    void import("@/scene/hero3d").then(({ startHero3d }) => {
      if (cancelled || !canvas.current || !stage.current) return;
      stop = startHero3d(canvas.current, stage.current, tags.map((t) => t.current), reduce);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const o = featured?.offering;
  const notStarted = !!o?.startAt && Date.now() < new Date(o.startAt).getTime();
  return (
    <section className="hero">
      <div className="stage" ref={stage}>
        <canvas ref={canvas} id="car3d" aria-hidden="true" />
        <div className="tag3d" ref={tags[0]} aria-hidden="true"><b>AUTO</b>{h.tagAuto}</div>
        <div className="tag3d" ref={tags[1]} aria-hidden="true"><b>ROBOTAXI</b>{h.tagRide}</div>
        <div className="tag3d" ref={tags[2]} aria-hidden="true"><b>USDT</b>{h.tagPaid}</div>
      </div>
      <div className="shade" />
      <div className="scanline" />
      <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
      <div className="wrap">
        <div className="eyebrow" style={{ color: "var(--lidar)" }}>{h.eyebrow}</div>
        <h1 style={{ marginTop: 14 }}>
          {h.h1.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              <span className="word" style={{ animationDelay: `${i * 0.18}s` }}>{emphasize(line)}</span>
            </span>
          ))}
        </h1>
        <p className="lead">
          {h.lead}
        </p>
        <div className="cta">
          {featured ? (
            <Link className="btn primary" href={`/projects/${featured.id}`}>{h.buyNow(projectCode(featured))}</Link>
          ) : (
            <Link className="btn primary" href="/projects">{h.viewProjects}</Link>
          )}
          {featured && <Link className="btn ghost" href="/projects">{h.allProjects}</Link>}
        </div>
        {o && (
          <div className="hud">
            <div className="h">
              <span className="eyebrow">{h.perUnit}</span>
              <div className="num">{formatUsdt(o.unitPrice)}<span className="muted" style={{ fontSize: ".8rem" }}> USDT</span></div>
            </div>
            <div className="h">
              <span className="eyebrow">{h.sold}</span>
              <div className="num">{o.unitsSold}<span className="muted" style={{ fontSize: ".8rem" }}> / {t.units.n(o.maxUnits)}</span></div>
            </div>
            <div className="h">
              <span className="eyebrow">{notStarted ? h.startsIn : h.timeLeft}</span>
              <div className="num mono" style={{ fontSize: "1.1rem" }}>{countdown(notStarted ? o.startAt! : o.endAt, Date.now(), t.ui.days)}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
