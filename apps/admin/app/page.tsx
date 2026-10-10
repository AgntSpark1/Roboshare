"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, formatDate, formatUsdt, StatePill } from "@roboshare/ui";
import { useHealth, useProjects, useReports, projectName } from "@/lib/data";
import { useRoles } from "@/lib/admin";

interface Recon {
  items: { id: string; runAt: string; ok: boolean; issues: { scope: string }[] }[];
}

export default function Overview() {
  const projects = useProjects();
  const health = useHealth();
  const submitted = useReports("SUBMITTED");
  const recon = useQuery({ queryKey: ["admin", "recon"], queryFn: () => api.get<Recon>("/admin/reconciliation") });
  const { can } = useRoles();
  const items = projects.data?.items ?? [];
  const settleable = items.filter((p) => p.state === "OFFERING" && p.offering && p.offering.status === "OPEN" && p.offering.unitsSold >= p.offering.minUnits);
  const lastRun = recon.data?.items[0];
  return (
    <>
      <div className="tiles">
        <div className="tile"><span className="eyebrow">车辆项目</span><span className="num">{items.length}</span><small className="muted">运营中 {items.filter((p) => p.state === "ACTIVE").length}</small></div>
        <div className="tile"><span className="eyebrow">募集中</span><span className="num">{items.filter((p) => p.state === "OFFERING").length}</span><small className="muted">可结算 {settleable.length}</small></div>
        <div className="tile"><span className="eyebrow">待审核报告</span><span className="num">{submitted.data?.items.length ?? "—"}</span><small className="muted">需要另一位审核人批准</small></div>
        <div className="tile"><span className="eyebrow">索引区块</span><span className="num">{health.data?.indexer ? `#${health.data.indexer.lastBlock}` : "—"}</span><small className="muted">{formatDate(health.data?.indexer?.updatedAt)}</small></div>
      </div>
      <div className="g32">
        <section className="panel" aria-labelledby="todo">
          <h2 id="todo">待办</h2>
          {settleable.map((p) => (
            <div className="q" key={p.id}>
              <span className="ic" aria-hidden="true">结</span>
              <div><h3 className="h4">{projectName(p)} 达到最低份数</h3><small>已认购 {p.offering!.unitsSold} / 最低 {p.offering!.minUnits} 份</small></div>
              {can("OPERATOR") ? <Link className="btn sm" href="/offerings">去结算</Link> : <span className="lab">需运营角色</span>}
            </div>
          ))}
          {(submitted.data?.items ?? []).map((r) => (
            <div className="q" key={r.id}>
              <span className="ic" aria-hidden="true">审</span>
              <div>
                <h3 className="h4">{projectName(items.find((p) => p.id === r.projectIdOnchain))} 财务报告</h3>
                <small>可分配 {formatUsdt(r.distributableAmount)} USDT · {r.recordIdOnchain ? "哈希已上链" : "等待上链"}</small>
              </div>
              {can("REVIEWER") ? <Link className="btn sm" href="/reports">去审核</Link> : <span className="lab">需审核角色</span>}
            </div>
          ))}
          {settleable.length === 0 && !submitted.data?.items.length && <p className="empty">暂无待办。</p>}
        </section>
        <section className="panel" aria-labelledby="sys">
          <h2 id="sys">系统状态</h2>
          <div className="health">
            <div><span>索引器</span><span className={health.data?.indexer ? "c-good" : "c-warn"}>{health.data?.indexer ? "运行中" : "未就绪"}</span></div>
            <div><span>最近对账</span><span className={lastRun ? (lastRun.ok ? "c-good" : "c-bad") : "c-dim"}>{lastRun ? (lastRun.ok ? "一致" : `${lastRun.issues.length} 处差异`) : "尚未运行"}</span></div>
            <div><span>对账时间</span><span>{formatDate(lastRun?.runAt)}</span></div>
          </div>
        </section>
      </div>
      <section className="panel" aria-labelledby="plist">
        <h2 id="plist">项目</h2>
        <div className="tw">
          <table>
            <thead><tr><th>项目</th><th>状态</th><th className="r">已发行</th><th className="r">募集</th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>{projectName(p)}</td>
                  <td><StatePill state={p.state} /></td>
                  <td className="r">{p.issuedUnits}</td>
                  <td className="r">{p.offering ? `${p.offering.unitsSold}/${p.offering.maxUnits}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
