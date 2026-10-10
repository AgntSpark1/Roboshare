"use client";
import { useState } from "react";
import { api, type PreparedTx } from "@roboshare/ui";
import { PreparedList } from "@/components/Proposal";
import { errorText, useRoles } from "@/lib/admin";
import { projectName, useProjects } from "@/lib/data";

export default function Governance() {
  const { can } = useRoles();
  const projects = useProjects();
  const [scope, setScope] = useState<"platform" | "project">("project");
  const [pid, setPid] = useState("");
  const [reason, setReason] = useState("");
  const [txs, setTxs] = useState<PreparedTx[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const withContracts = (projects.data?.items ?? []).filter((p) => !["NONE", "DRAFT", "VERIFIED"].includes(p.state));
  const project = pid || withContracts[0]?.id || "";
  async function prepare() {
    setErr(null);
    setTxs(null);
    try {
      const r = await api.post<{ txs: PreparedTx[] }>("/admin/pause", { scope, projectId: scope === "project" ? project : undefined, reason });
      setTxs(r.txs);
    } catch (e) {
      setErr(errorText(e));
    }
  }
  return (
    <>
      <section className="panel" aria-labelledby="gov">
        <h2 id="gov">治理规则</h2>
        <div className="health">
          <div><span>治理 Safe</span><span>3 人中 2 人签名</span></div>
          <div><span>时间锁</span><span>24 小时后执行</span></div>
          <div><span>紧急暂停</span><span>Guardian Safe 直接执行，不等时间锁</span></div>
          <div><span>强制转移 / 私钥找回</span><span className="c-good">不存在（合约不支持）</span></div>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>本控制台只生成待签名的交易数据，从不代签或发送治理交易。</p>
      </section>
      <section className="panel" aria-labelledby="pause">
        <h2 id="pause">紧急暂停</h2>
        {!can("GOV_VIEW") ? (
          <p className="empty">需要治理角色。</p>
        ) : (
          <div className="form">
            <div className="fgrid">
              <label className="field"><span>范围</span>
                <select value={scope} onChange={(e) => setScope(e.target.value as "platform" | "project")}>
                  <option value="project">单个项目（转让、募集、分配）</option>
                  <option value="platform">全平台（新认购、资格变更）</option>
                </select>
              </label>
              {scope === "project" && (
                <label className="field"><span>项目</span>
                  <select value={project} onChange={(e) => setPid(e.target.value)}>{withContracts.map((p) => <option key={p.id} value={p.id}>{projectName(p)}</option>)}</select>
                </label>
              )}
            </div>
            <label className="field"><span>原因（记入审计日志）</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <div><button type="button" className="btn danger sm" disabled={reason.trim().length < 3 || (scope === "project" && !project)} onClick={prepare}>生成暂停交易</button></div>
            {err && <p className="err" role="alert">{err}</p>}
            {txs && <PreparedList txs={txs} />}
          </div>
        )}
      </section>
    </>
  );
}
