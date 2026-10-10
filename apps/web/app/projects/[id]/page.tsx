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
                  募集期 {formatDate(o.startAt)} 至 {formatDate(o.endAt)}。部分募集允许：只要达到最低份数即可结算，未售出的份额永不发行。
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
                {p.state === "ACTIVE" ? "车辆已投入运营。每期报告经审核人批准后生成分配批次，持有人在“我的资产”领取。" : "该项目当前不接受认购。"}
              </p>
              <Link className="btn ghost" href="/portfolio">查看我的资产</Link>
            </aside>
          )}
        </div>

        <div className="cols2" style={{ marginTop: 24 }}>
          <div className="panel">
            <h2 className="h3">已批准的财务报告 <span className="lab ok">审核人批准</span></h2>
            {fin.data?.items.length ? (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">已批准的财务报告</caption>
                  <thead><tr><th>期间</th><th className="r">收入</th><th className="r">可分配利润</th><th>报告哈希</th></tr></thead>
                  <tbody>
                    {fin.data.items.map((f) => (
                      <tr key={f.recordId}>
                        <td>{formatDate(f.periodStart).slice(0, 10)} – {formatDate(f.periodEnd).slice(0, 10)}</td>
                        <td className="r">{f.grossRevenue ? formatUsdt(f.grossRevenue) : "—"}</td>
                        <td className="r">{formatUsdt(f.distributableAmount)}</td>
                        <td><span className="hash">{shortAddr(f.contentHash, 10, 6)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">还没有已批准的报告。</p>
            )}
            <p className="muted" style={{ fontSize: ".74rem", marginTop: 10 }}>“审核人批准”表示平台审核人已核对，不等同于外部审计。</p>
          </div>
          <div className="panel">
            <h2 className="h3">分配批次</h2>
            {dist.data?.items.length ? (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">分配批次</caption>
                  <thead><tr><th>批次</th><th className="r">分配金额</th><th className="r">投资者净额合计</th><th>快照区块</th></tr></thead>
                  <tbody>
                    {dist.data.items.map((b) => (
                      <tr key={b.batchId}>
                        <td>#{b.batchId}</td>
                        <td className="r">{formatUsdt(b.amount)}</td>
                        <td className="r">{formatUsdt(b.totalNet)}</td>
                        <td className="mono">{b.snapshotBlock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">还没有可领取的分配批次。</p>
            )}
            <p className="muted" style={{ fontSize: ".74rem", marginTop: 10 }}>
              运营方分成：{p.feeTiers.map((t) => `${t.minUnits}+ 份 ${formatBps(t.bps)}`).join(" · ")}
            </p>
          </div>
        </div>

        <div className="cols2" style={{ marginTop: 16 }}>
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
      </div>
    </section>
  );
}
