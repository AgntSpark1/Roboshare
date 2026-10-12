"use client";
import { useState } from "react";
import { api, formatDate, shortAddr, type SafeProposal } from "@roboshare/ui";
import { ProposalView } from "@/components/Proposal";
import { explorer } from "@/env";
import { errorText, useRoles } from "@/lib/admin";
import { eventText, useAutopilot } from "@/lib/data";

/** Monthly profit distribution that runs by itself (worker autopilot), and what it needs from staff. */
export default function Autopilot() {
  const q = useAutopilot();
  const { can } = useRoles();
  const [proposal, setProposal] = useState<SafeProposal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  async function roles(action: "grant" | "revoke") {
    if (action === "revoke" && !window.confirm("撤销后自动分配立即停止，之后要人工发起分配。确定？")) return;
    setErr(null);
    try {
      setProposal((await api.post<{ proposal: SafeProposal }>("/admin/autopilot/roles", { action })).proposal);
    } catch (e) {
      setErr(errorText(e));
    }
  }
  return (
    <>
      <section className="panel" aria-labelledby="ap">
        <h2 id="ap">每月自动分配</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>
          每月 2 日（北京时间）起，系统把上个月每天录入的运营收入和支出汇总成运营报告，自动审核，按持有份数生成分配，开放给投资者领取。全程不需要人工点击。资金账户里要有足够的 USDT 并授权给分配合约，否则会在这里提醒。
        </p>
        {q.error && <p className="err" role="alert">{errorText(q.error)}</p>}
        {d && (
          <div className="health">
            <div><span>状态</span><b className={d.ready ? "c-good" : "c-warn"}>{!d.configured ? "未配置自动分配钱包" : d.ready ? "运行中" : "等待多签授权"}</b></div>
            <div><span>提交钱包（运营权限）</span><span className="mono">{d.submitter ? shortAddr(d.submitter) : "—"}</span></div>
            <div><span>审核钱包（审核权限）</span><span className="mono">{d.approver ? shortAddr(d.approver) : "—"}</span></div>
            <div><span>单月自动分配上限</span><span>超过上限的月份需人工在“分配批次”里发起</span></div>
          </div>
        )}
        {d?.issues.length ? (
          <div className="warnbox" style={{ marginTop: 12 }}>
            {d.issues.map((e) => <div key={e.id}>{formatDate(e.createdAt)} · {eventText(e)}</div>)}
          </div>
        ) : null}
      </section>

      {d?.configured && (
        <section className="panel" aria-labelledby="perm">
          <h2 id="perm">权限</h2>
          <p className="muted small" style={{ marginBottom: 8 }}>
            两个钱包只能提交/审核运营报告和提议/批准分配，不能改合约参数、不能改权限，资金只会按份额发给持有人。多签可以随时撤销。
          </p>
          <div className="tw">
            <table>
              <thead><tr><th>合约</th><th>提交钱包</th><th>审核钱包</th></tr></thead>
              <tbody>
                {d.contracts.map((c) => (
                  <tr key={c.address}>
                    <td>{c.kind === "AUDIT_REGISTRY" ? "运营报告登记" : `分配合约 · ${c.label}`}</td>
                    <td className={c.submitterOk ? "c-good" : "c-warn"}>{c.submitterOk ? "已授权" : "未授权"}</td>
                    <td className={c.approverOk ? "c-good" : "c-warn"}>{c.approverOk ? "已授权" : "未授权"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can("GOV_VIEW", "OPERATOR") && (
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" className="btn primary sm" onClick={() => roles("grant")}>{d.ready ? "为新项目补授权" : "生成授权多签交易"}</button>
              <button type="button" className="btn danger sm" onClick={() => roles("revoke")}>停止自动分配（撤销权限）</button>
            </div>
          )}
          {err && <p className="err" role="alert">{err}</p>}
          {proposal && <div style={{ marginTop: 12 }}><ProposalView proposal={proposal} /></div>}
        </section>
      )}

      <section className="panel" aria-labelledby="log">
        <h2 id="log">执行记录</h2>
        {!d?.events.length && <p className="empty">还没有记录。</p>}
        {d?.events.map((e) => (
          <div className="q" key={e.id}>
            <span className="ic" aria-hidden="true">{e.kind.startsWith("BATCH") ? "分" : e.kind.startsWith("REPORT") ? "报" : "!"}</span>
            <div>
              <h3 className="h4">{eventText(e)}</h3>
              <small>
                {formatDate(e.createdAt)}
                {e.txHash && explorer && <> · <a href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">查看交易</a></>}
              </small>
            </div>
            <span />
          </div>
        ))}
      </section>
    </>
  );
}
