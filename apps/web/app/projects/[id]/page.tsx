"use client";
import Link from "next/link";
import { use } from "react";
import { formatBps, formatDate, formatUsdt, OfferingProgress, shortAddr, StatePill, stateLabel } from "@roboshare/ui";
import { CarArt } from "@/components/CarArt";
import { projectCode } from "@/components/ProjectCard";
import { SubscribePanel } from "@/components/SubscribePanel";
import { explorer } from "@/env";
import { useFinancials, useProject, useProjectDistributions } from "@/lib/data";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useProject(id);
  const fin = useFinancials(id);
  const dist = useProjectDistributions(id);

  if (q.isLoading) return <section><div className="wrap"><p className="muted">正在读取项目…</p></div></section>;
  if (q.error || !q.data)
    return (
      <section>
        <div className="wrap">
          <p className="err" role="alert">找不到这个项目。</p>
          <Link className="btn ghost" href="/projects">返回项目列表</Link>
        </div>
      </section>
    );
  const p = q.data;
  const code = projectCode({ slug: p.meta?.slug ?? null, id: p.id });
  const o = p.offering;
  const link = (kind: "address" | "tx", v: string | null) =>
    v ? (explorer ? <a className="hash" href={`${explorer}/${kind}/${v}`} target="_blank" rel="noreferrer">{shortAddr(v, 8, 6)}</a> : <span className="hash">{shortAddr(v, 8, 6)}</span>) : "—";

  return (
    <section>
      <div className="wrap">
        <nav className="crumb" aria-label="面包屑"><Link href="/projects">车辆项目</Link> / {code}</nav>
        <div className="dhead">
          <div>
            <div className="dart">
              <CarArt id={p.id} code={code} />
              <span className="tag">示意图 · 非实车照片</span>
            </div>
            <div className="title-row">
              <h1>{p.meta?.title ?? code}</h1>
              <StatePill state={p.state} />
            </div>
            <p className="muted">{p.meta?.summary ?? "该项目尚未填写简介。"}</p>
            <div className="facts">
              <div><span>车型</span><b>{[p.meta?.make, p.meta?.model].filter(Boolean).join(" ") || "—"}</b></div>
              <div><span>已发行 / 上限</span><b>{p.issuedUnits} / {p.authorizedUnits} 份</b></div>
              <div><span>权益类型</span><b>利润分配合同权益</b></div>
              <div><span>结算币种</span><b>USDT</b></div>
            </div>
            {o && p.state === "OFFERING" && (
              <div className="panel" style={{ marginTop: 18 }}>
                <h2 className="h3">募集进度</h2>
                <OfferingProgress sold={o.unitsSold} min={o.minUnits} max={o.maxUnits} />
                <p className="muted" style={{ fontSize: ".8rem", marginTop: 10 }}>
                  募集截止 {formatDate(o.endAt)}。达到 {o.minUnits} 份即成团，未成团全额退款。
                </p>
              </div>
            )}
          </div>
          {o && p.state === "OFFERING" ? (
            <SubscribePanel p={p} />
          ) : (
            <aside className="buy" aria-label="项目状态">
              <div className="line"><span className="muted">当前状态</span><b>{stateLabel(p.state)}</b></div>
              <p className="muted" style={{ fontSize: ".84rem" }}>
                {p.state === "ACTIVE" ? "车辆运营中，每期收益可在“我的资产”领取。" : "该项目当前不接受认购。"}
              </p>
              <Link className="btn ghost" href="/portfolio">查看我的资产</Link>
            </aside>
          )}
        </div>

        <div className="cols2" style={{ marginTop: 24 }}>
          <div className="panel">
            <h2 className="h3">运营报告</h2>
            {fin.data?.items.length ? (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">运营报告</caption>
                  <thead><tr><th>期间</th><th className="r">收入</th><th className="r">可分配利润</th></tr></thead>
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
              <p className="muted">车辆投入运营后，每期报告会显示在这里。</p>
            )}
            <p className="fine" style={{ marginTop: 10 }}>报告经平台审核，不等同于外部审计。</p>
          </div>
          <div className="panel">
            <h2 className="h3">收益分配</h2>
            {dist.data?.items.length ? (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">收益分配</caption>
                  <thead><tr><th>期数</th><th className="r">分配金额（USDT）</th></tr></thead>
                  <tbody>
                    {dist.data.items.map((b) => (
                      <tr key={b.batchId}>
                        <td>第 {b.batchId} 期</td>
                        <td className="r">{formatUsdt(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">首期收益分配后会显示在这里。</p>
            )}
            <p className="fine" style={{ marginTop: 10 }}>
              平台分成：{p.feeTiers.map((t) => `${t.minUnits}+ 份 ${formatBps(t.bps)}`).join(" · ")}
            </p>
          </div>
        </div>

        <details className="chain-info">
          <summary>链上信息</summary>
          <div className="cols2" style={{ marginTop: 8 }}>
            <div className="panel">
              <h2 className="h3">合约地址</h2>
              <div className="health">
                <div><span>份额代币</span>{link("address", p.contracts.token)}</div>
                <div><span>募集合约</span>{link("address", p.contracts.offering)}</div>
                <div><span>分配合约</span>{link("address", p.contracts.distributor)}</div>
              </div>
            </div>
            <div className="panel">
              <h2 className="h3">状态记录</h2>
              <div className="timeline">
                {p.stateHistory.map((s) => (
                  <div className="tl" key={s.chain.txHash + s.to}>
                    <i aria-hidden="true" />
                    <span>{stateLabel(s.to)}</span>
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
