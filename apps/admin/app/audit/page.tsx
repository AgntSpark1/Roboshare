"use client";
import { useQuery } from "@tanstack/react-query";
import { api, formatDate, shortAddr } from "@roboshare/ui";

interface Action {
  id: string;
  wallet: string;
  action: string;
  targetType: string;
  targetId: string;
  payloadHash: string;
  createdAt: string;
}
interface Run {
  id: string;
  runAt: string;
  ok: boolean;
  issues: { scope: string; detail?: unknown }[];
}

export default function Audit() {
  const log = useQuery({ queryKey: ["admin", "audit"], queryFn: () => api.get<{ items: Action[] }>("/admin/audit-log?limit=100") });
  const recon = useQuery({ queryKey: ["admin", "recon"], queryFn: () => api.get<{ items: Run[] }>("/admin/reconciliation") });
  return (
    <>
      <section className="panel" aria-labelledby="rc">
        <h2 id="rc">链上 / 数据库对账</h2>
        {(recon.data?.items ?? []).length === 0 && <p className="empty">尚未运行对账。</p>}
        {(recon.data?.items ?? []).map((r) => (
          <div className="line" key={r.id}>
            <span>{formatDate(r.runAt)}</span>
            <span className={r.ok ? "c-good" : "c-bad"}>{r.ok ? "一致" : `差异：${r.issues.map((i) => i.scope).join("、")}`}</span>
          </div>
        ))}
        <p className="muted small" style={{ marginTop: 8 }}>对账发现差异时，分配批次会被自动阻止，直到差异解决。</p>
      </section>
      <section className="panel" aria-labelledby="al">
        <h2 id="al">审计日志</h2>
        <div className="tw">
          <table>
            <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象</th><th>内容哈希</th></tr></thead>
            <tbody>
              {(log.data?.items ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{formatDate(a.createdAt)}</td>
                  <td className="mono">{shortAddr(a.wallet)}</td>
                  <td>{a.action}</td>
                  <td>{a.targetType} {shortAddr(a.targetId, 8, 4)}</td>
                  <td className="hash">{shortAddr(a.payloadHash, 8, 6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
