"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { countdown, formatUsdt, type ProjectListItem } from "@roboshare/ui";
import { projectCode } from "./ProjectCard";

export function Hero({ featured }: { featured?: ProjectListItem }) {
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
  return (
    <section className="hero">
      <div className="stage" ref={stage}>
        <canvas ref={canvas} id="car3d" aria-hidden="true" />
        <div className="tag3d" ref={tags[0]} aria-hidden="true"><b>AUTO</b>自动驾驶</div>
        <div className="tag3d" ref={tags[1]} aria-hidden="true"><b>ROBOTAXI</b>网约车运营</div>
        <div className="tag3d" ref={tags[2]} aria-hidden="true"><b>USDT</b>按期领取</div>
      </div>
      <div className="shade" />
      <div className="scanline" />
      <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
      <div className="wrap">
        <div className="eyebrow" style={{ color: "var(--lidar)" }}>ROBOTAXI 收益份额 · USDT 结算</div>
        <h1 style={{ marginTop: 14 }}>
          <span className="word">把一辆</span> <span className="word" style={{ animationDelay: ".12s" }}><em>Robotaxi</em></span>
          <br />
          <span className="word" style={{ animationDelay: ".24s" }}>拆成</span> <span className="word" style={{ animationDelay: ".36s" }}><em>100</em> 份</span>
        </h1>
        <p className="lead">
          按份认购自动驾驶网约车的运营收益，每期以 USDT 发到你的钱包，账目公开可查。
        </p>
        <div className="cta">
          {featured ? (
            <Link className="btn primary" href={`/projects/${featured.id}`}>立即认购 {projectCode(featured)}</Link>
          ) : (
            <Link className="btn primary" href="/projects">查看车辆项目</Link>
          )}
          {featured && <Link className="btn ghost" href="/projects">全部项目</Link>}
        </div>
        {o && (
          <div className="hud">
            <div className="h">
              <span className="eyebrow">每份</span>
              <div className="num">{formatUsdt(o.unitPrice)}<span className="muted" style={{ fontSize: ".8rem" }}> USDT</span></div>
            </div>
            <div className="h">
              <span className="eyebrow">已认购</span>
              <div className="num">{o.unitsSold}<span className="muted" style={{ fontSize: ".8rem" }}> / {o.maxUnits} 份</span></div>
            </div>
            <div className="h">
              <span className="eyebrow">剩余时间</span>
              <div className="num mono" style={{ fontSize: "1.1rem" }}>{countdown(o.endAt)}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
