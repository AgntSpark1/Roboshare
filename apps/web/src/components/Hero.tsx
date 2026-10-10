"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { ProjectListItem } from "@roboshare/ui";
import { CHAIN_NAME, walletEnv } from "@/env";
import { projectCode } from "./ProjectCard";

export function Hero({ featured, lastBlock }: { featured?: ProjectListItem; lastBlock?: string }) {
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
        <div className="tag3d" ref={tags[0]} aria-hidden="true"><b>LiDAR</b>360° 点云扫描</div>
        <div className="tag3d" ref={tags[1]} aria-hidden="true"><b>ROBOTAXI</b>示意画面</div>
        <div className="tag3d" ref={tags[2]} aria-hidden="true"><b>USDT</b>按期链上分配</div>
      </div>
      <div className="shade" />
      <div className="scanline" />
      <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
      <div className="readout" aria-hidden="true">
        SCAN 10Hz · 示意动画<br />CHAIN {walletEnv.chainId} · BLOCK #{lastBlock ?? "—"}
      </div>
      <div className="wrap">
        <div className="eyebrow" style={{ color: "var(--lidar)" }}>BNB SMART CHAIN · USDT BEP20 · 每车 100 份</div>
        <h1 style={{ marginTop: 14 }}>
          <span className="word">把一辆</span> <span className="word" style={{ animationDelay: ".12s" }}><em>Robotaxi</em></span>
          <br />
          <span className="word" style={{ animationDelay: ".24s" }}>拆成</span> <span className="word" style={{ animationDelay: ".36s" }}><em>100</em> 份</span>
        </h1>
        <p className="lead">
          按份额认购单辆自动驾驶网约车的利润分配权。运营报告哈希上链、审核人批准后才能分配，收益以 USDT 发放到你的钱包，自己领取。
        </p>
        <div className="cta">
          <Link className="btn primary" href="/projects">浏览车辆项目</Link>
          {featured && <Link className="btn ghost" href={`/projects/${featured.id}`}>查看正在募集的 {projectCode(featured)}</Link>}
        </div>
        <div className="hud">
          <div className="h">
            <span className="eyebrow">{featured ? `${projectCode(featured)} 募集进度` : "募集中的项目"}</span>
            <div className="num">
              {o ? o.unitsSold : 0}
              <span className="muted" style={{ fontSize: ".8rem" }}> / 100 份</span>
            </div>
          </div>
          <div className="h">
            <span className="eyebrow">网络</span>
            <div className="num" style={{ fontSize: "1.05rem" }}>{CHAIN_NAME[walletEnv.chainId] ?? walletEnv.chainId}</div>
          </div>
          <div className="h">
            <span className="eyebrow">已索引区块</span>
            <div className="num mono" style={{ fontFamily: "var(--f-mono)", fontSize: "1.1rem" }}>{lastBlock ? `#${Number(lastBlock).toLocaleString("en")}` : "—"}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Fleet() {
  const ref = useRef<HTMLCanvasElement>(null);
  const cars = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("@/scene/city").then(({ startCity }) => {
      if (cancelled || !ref.current) return;
      stop = startCity(ref.current, reduce, (n: number) => cars.current && (cars.current.textContent = String(n)));
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return (
    <div className="fleet">
      <canvas ref={ref} id="city" aria-hidden="true" />
      <div className="ov">
        <div className="h"><span className="eyebrow">模拟车辆</span><div className="num" ref={cars}>—</div></div>
        <div className="h"><span className="eyebrow">说明</span><div className="num" style={{ fontSize: ".9rem" }}>示意动画，非实时数据</div></div>
      </div>
      <span className="live">SIMULATION · 示意</span>
    </div>
  );
}
