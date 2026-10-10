"use client";
import Link from "next/link";
import { useState } from "react";
import { DEFAULT_TIERS, allocate } from "@roboshare/shared";
import { formatBps, formatUsdt } from "@roboshare/ui";
import { Hero } from "@/components/Hero";
import { ProjectCard } from "@/components/ProjectCard";
import { useProjects } from "@/lib/data";

const SAMPLE_D = 880n * 10n ** 18n; // illustrative distributable profit for the calculator only

export default function Home() {
  const projects = useProjects();
  const items = projects.data?.items ?? [];
  const featured = items.find((p) => p.state === "OFFERING");
  return (
    <>
      <Hero featured={featured} />

      <section>
        <div className="wrap">
          <div className="sec-h">
            <h2>正在募集</h2>
            <Link className="btn sm ghost" href="/projects">全部项目 →</Link>
          </div>
          {projects.isLoading ? (
            <p className="muted">正在加载项目…</p>
          ) : projects.error ? (
            <p className="err" role="alert">项目暂时加载不出来，请稍后刷新。</p>
          ) : items.length === 0 ? (
            <div className="panel empty"><p className="muted">新项目即将上线，敬请关注。</p></div>
          ) : (
            <div className="grid">{items.filter((p) => p.state !== "CANCELLED").slice(0, 3).map((p) => <ProjectCard key={p.id} p={p} />)}</div>
          )}
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-h"><h2>三步开始</h2></div>
          <div className="steps">
            <div className="step"><div className="bar" /><h3>连接钱包</h3><p>用常用的钱包 App 打开本站即可。</p></div>
            <div className="step"><div className="bar" /><h3>选择份数，USDT 支付</h3><p>按份认购，小额也能参与。</p></div>
            <div className="step"><div className="bar" /><h3>按期领取收益</h3><p>每期运营收益以 USDT 发到“我的资产”，一键领取。</p></div>
          </div>
        </div>
      </section>

      <TierCalculator />

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-h"><h2>你的资金有保障</h2></div>
          <div className="trust">
            <div>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z" /><path d="M9 12l2 2 4-4" /></svg>
              <h3>未成团全额退款</h3>
              <p>募集期结束没达到最低份数，USDT 原路全额退回。</p>
            </div>
            <div>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 13h5M10 17h5" /></svg>
              <h3>账目公开可查</h3>
              <p>每期运营报告记录在链上，收益怎么算、分了多少，随时可查。</p>
            </div>
            <div>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
              <h3>份额只属于你</h3>
              <p>份额在你自己的钱包里，平台无法转走；分配规则写在合约里，不能随意更改。</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function TierCalculator() {
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
          <h2>持有越多，到手越多</h2>
          <p>不收管理费，平台只从利润中按档位分成，持有份数越多分成比例越低。拖动滑块试试。</p>
        </div>
        <div className="tiers">
          <div className="tier-rows">
            {DEFAULT_TIERS.map((t, i) => {
              const next = DEFAULT_TIERS[i + 1];
              const on = units >= t.minUnits && (!next || units < next.minUnits);
              return (
                <div key={t.minUnits} className={`tier-row${on ? " on" : ""}`}>
                  <span className="u">{t.minUnits}–{next ? next.minUnits - 1 : 100} 份</span>
                  <span className="b"><i style={{ width: `${(t.bps / 2000) * 100}%` }} /></span>
                  <span className="p">{formatBps(t.bps)}</span>
                </div>
              );
            })}
          </div>
          <div className="calc">
            <div className="line"><span className="muted">持有份数（同一项目）</span><b>{units} 份</b></div>
            <input type="range" min={1} max={100} value={units} aria-label="持有份数" onChange={(e) => setUnits(Number(e.target.value))} />
            <div className="line"><span className="muted">示例：本期车辆利润</span><b>{formatUsdt(SAMPLE_D)} USDT</b></div>
            <div className="split" aria-hidden="true">
              <i style={{ background: "var(--amber)", width: `${pct(mine.net)}%` }} />
              <i style={{ background: "var(--lidar)", width: `${pct(fee)}%` }} />
            </div>
            <div className="legend"><span style={{ ["--c" as string]: "var(--amber)" }}>你到手</span><span style={{ ["--c" as string]: "var(--lidar)" }}>平台分成</span></div>
            <div className="line"><span className="muted">按份额分到</span><b>{formatUsdt(mine.gross)} USDT</b></div>
            <div className="line"><span className="muted">平台分成</span><b>− {formatUsdt(fee)} USDT（{formatBps(bps)}）</b></div>
            <div className="line total"><span>你到手</span><b>{formatUsdt(mine.net)} USDT</b></div>
            <p className="fine">示例数字，仅演示计算方式，实际收益以每期运营结果为准。</p>
          </div>
        </div>
      </div>
    </section>
  );
}
