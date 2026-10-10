"use client";
import Link from "next/link";
import { useState } from "react";
import { DEFAULT_TIERS, allocate } from "@roboshare/shared";
import { formatBps, formatUsdt } from "@roboshare/ui";
import { Fleet, Hero } from "@/components/Hero";
import { ProjectCard } from "@/components/ProjectCard";
import { useHealth, useProjects } from "@/lib/data";

const SAMPLE_D = 880n * 10n ** 18n; // illustrative distributable profit for the calculator only

export default function Home() {
  const projects = useProjects();
  const health = useHealth();
  const items = projects.data?.items ?? [];
  const featured = items.find((p) => p.state === "OFFERING");
  return (
    <>
      <Hero featured={featured} lastBlock={health.data?.indexer?.lastBlock} />

      <section>
        <div className="wrap">
          <div className="sec-h">
            <h2>车队调度示意</h2>
            <p>每个光点是一辆车，金色那辆代表你持有份额的车。这是示意动画，不是实时运营数据。</p>
          </div>
          <Fleet />
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="sec-h">
            <h2>四步完成一次认购</h2>
            <p>只用 USDT。授权一次之后，每次买入都只需要选择份数，一笔交易完成。</p>
          </div>
          <div className="steps">
            <div className="step"><div className="bar" /><h3>连接钱包并完成资格认证</h3><p>链上只记录钱包是否具备资格，不存个人信息。正式开放前会接入第三方 KYC。</p></div>
            <div className="step"><div className="bar" /><h3>授权一次 USDT</h3><p>向平台认购合约授权一次（默认不限额），授权前会展示风险提示，可随时撤销。</p></div>
            <div className="step"><div className="bar" /><h3>选择份数认购</h3><p>募集截止时达到最低份数就结算发币；未达到则全额退款。未售出的份额永不发行。</p></div>
            <div className="step"><div className="bar" /><h3>按期领取 USDT</h3><p>运营方提交报告，审核人批准后生成分配批次。你在“我的资产”里一键领取。</p></div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-h">
            <h2>车辆项目</h2>
            <Link className="btn sm ghost" href="/projects">全部项目 →</Link>
          </div>
          {projects.isLoading ? (
            <p className="muted">正在读取链上项目…</p>
          ) : projects.error ? (
            <p className="err" role="alert">暂时无法读取项目：{projects.error.message}</p>
          ) : items.length === 0 ? (
            <div className="panel empty"><p className="muted">还没有已登记的车辆项目。</p></div>
          ) : (
            <div className="grid">{items.filter((p) => p.state !== "CANCELLED").slice(0, 3).map((p) => <ProjectCard key={p.id} p={p} />)}</div>
          )}
        </div>
      </section>

      <TierCalculator />

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-h"><h2>规则写在合约里</h2></div>
          <div className="trust">
            <div>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
              <h3>2/3 多签 + 24 小时时间锁</h3>
              <p>治理操作需要 3 位签名人中的 2 位同意，并在执行前公示 24 小时。治理无法转走你的份额。</p>
            </div>
            <div>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 13h5M10 17h5" /></svg>
              <h3>报告哈希上链</h3>
              <p>每期财务报告的哈希写入链上审计登记合约，审核人批准后才能分配。只有经过外部审计的报告才会标注“已审计”。</p>
            </div>
            <div>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z" /><path d="M9 12l2 2 4-4" /></svg>
              <h3>合约不可升级</h3>
              <p>项目合约部署后逻辑不可更改。转让只在合格钱包之间进行，没有官方二级市场。</p>
            </div>
          </div>
          <div className="notice" style={{ marginTop: 18 }}>
            <b>请先阅读风险</b>
            <span>
              你可能损失部分或全部投资。份额不是车辆所有权，也不保证任何回报；丢失私钥无法找回。RoboShare 与 Tesla 不存在任何合作关系。{" "}
              <Link href="/risk" style={{ color: "var(--amber)" }}>阅读完整风险披露</Link>
            </span>
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
          <h2>持有越多，运营方分成越低</h2>
          <p>运营方不另收管理费，只按你在该项目快照时持有的份数分档抽成。拖动滑块看看示例分配。</p>
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
            <div className="line"><span className="muted">示例：本期项目可分配利润 D</span><b>{formatUsdt(SAMPLE_D)} USDT</b></div>
            <div className="split" aria-hidden="true">
              <i style={{ background: "var(--amber)", width: `${pct(mine.net)}%` }} />
              <i style={{ background: "var(--lidar)", width: `${pct(fee)}%` }} />
            </div>
            <div className="legend"><span style={{ ["--c" as string]: "var(--amber)" }}>你的净额</span><span style={{ ["--c" as string]: "var(--lidar)" }}>运营方分成</span></div>
            <div className="line"><span className="muted">你的毛额</span><b>{formatUsdt(mine.gross)} USDT</b></div>
            <div className="line"><span className="muted">运营方分成</span><b>− {formatUsdt(fee)} USDT（{formatBps(bps)}）</b></div>
            <div className="line total"><span>你领取的净额</span><b>{formatUsdt(mine.net)} USDT</b></div>
            <p className="muted" style={{ fontSize: ".74rem" }}>
              计算与合约一致：毛额 = D × 持有份数 ÷ 已发行份数（示例为 100）；分成按档位向下取整，取整偏向投资者。示例数字，不代表任何真实收益。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
