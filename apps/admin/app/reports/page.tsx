"use client";
import { useState } from "react";
import { api, formatDate, formatUsdt, parseUsdt, shortAddr, type PreparedTx } from "@roboshare/ui";
import { TxAction } from "@/components/TxAction";
import { useAdminMe, useRoles } from "@/lib/admin";
import { projectName, useProjects, useRefresh, useReports, useUsdt, type ReportRow } from "@/lib/data";

const STATUS: Record<string, [string, string]> = {
  SUBMITTED: ["待审核", "c-amber"],
  APPROVED: ["已批准", "c-good"],
  REJECTED: ["已驳回", "c-bad"],
  SUPERSEDED: ["已被更正", "c-dim"],
};

export default function Reports() {
  const { can } = useRoles();
  const reports = useReports();
  const projects = useProjects();
  const refresh = useRefresh();
  const name = (id: string) => projectName(projects.data?.items.find((p) => p.id === id));
  return (
    <>
      {can("OPERATOR") && <SubmitReport onDone={refresh} />}
      <section className="panel" aria-labelledby="rl">
        <h2 id="rl">财务报告</h2>
        {(reports.data?.items ?? []).length === 0 && <p className="empty">还没有提交的报告。</p>}
        {(reports.data?.items ?? []).map((r) => (
          <ReportItem key={r.id} r={r} name={name(r.projectIdOnchain)} canReview={can("REVIEWER")} onDone={refresh} />
        ))}
      </section>
    </>
  );
}

function ReportItem({ r, name, canReview, onDone }: { r: ReportRow; name: string; canReview: boolean; onDone: () => void }) {
  const me = useAdminMe();
  const [reason, setReason] = useState("");
  const mine = me.data?.wallet.toLowerCase() === r.submittedByWallet.toLowerCase();
  const [label, cls] = STATUS[r.status] ?? [r.status, "c-dim"];
  return (
    <div className="q" data-testid={`report-${r.id}`}>
      <span className="ic" aria-hidden="true">报</span>
      <div>
        <h3 className="h4">{name} · {formatDate(r.periodStart).slice(0, 10)} 至 {formatDate(r.periodEnd).slice(0, 10)} <span className={`pill ${cls}`}>{label}</span></h3>
        <small>
          收入 {formatUsdt(r.grossRevenue)} − 支出 {formatUsdt(r.totalExpenses)} − 储备 {formatUsdt(r.totalReserves)} = 可分配 <b>{formatUsdt(r.distributableAmount)} USDT</b>
        </small>
        <small>
          提交人 <span className="mono">{shortAddr(r.submittedByWallet)}</span> · 内容哈希 <span className="hash">{shortAddr(r.canonicalHash, 10, 6)}</span> ·{" "}
          {r.recordIdOnchain ? "哈希已上链" : "等待哈希上链（索引器确认后可审核）"}
        </small>
      </div>
      {r.status === "SUBMITTED" && canReview && (
        mine ? (
          <span className="lab">不能审核自己提交的报告</span>
        ) : (
          <div className="stack" style={{ gap: 6, justifyItems: "end" }}>
            <TxAction
              label="批准"
              className="btn good sm"
              disabled={!r.recordIdOnchain}
              prepare={async () => (await api.post<{ tx: PreparedTx }>(`/admin/reports/${r.id}/review`, { decision: "APPROVE" })).tx}
              onDone={onDone}
            />
            <label className="field" style={{ minWidth: 180 }}>
              <span className="sr-only">驳回原因</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="驳回原因" />
            </label>
            <TxAction
              label="驳回"
              className="btn danger sm"
              disabled={!r.recordIdOnchain || reason.trim().length < 3}
              prepare={async () => (await api.post<{ tx: PreparedTx }>(`/admin/reports/${r.id}/review`, { decision: "REJECT", reason })).tx}
              onDone={onDone}
            />
          </div>
        )
      )}
    </div>
  );
}

interface Line {
  category: string;
  description: string;
  amount: string;
}

function LineEditor({ title, lines, setLines, cats }: { title: string; lines: Line[]; setLines: (l: Line[]) => void; cats: string[] }) {
  const upd = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <fieldset className="lines" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="muted small">{title}</legend>
      {lines.map((l, i) => (
        <div className="ln" key={i}>
          <label className="field"><span>类别</span>
            <select value={l.category} onChange={(e) => upd(i, "category", e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="field"><span>说明</span><input value={l.description} onChange={(e) => upd(i, "description", e.target.value)} /></label>
          <label className="field"><span>金额（USDT）</span><input value={l.amount} inputMode="decimal" onChange={(e) => upd(i, "amount", e.target.value)} /></label>
          <button type="button" className="btn sm" aria-label={`删除${title}第 ${i + 1} 行`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>删除</button>
        </div>
      ))}
      <div><button type="button" className="btn sm" onClick={() => setLines([...lines, { category: cats[0]!, description: "", amount: "" }])}>添加一行</button></div>
    </fieldset>
  );
}

function sum(lines: Line[]): bigint | null {
  try {
    return lines.reduce((s, l) => s + parseUsdt(l.amount || "0"), 0n);
  } catch {
    return null;
  }
}

function SubmitReport({ onDone }: { onDone: () => void }) {
  const projects = useProjects();
  const usdt = useUsdt();
  const eligible = (projects.data?.items ?? []).filter((p) => ["ACTIVE", "EXIT_PENDING", "TERMINATED", "SUSPENDED"].includes(p.state));
  const [pid, setPid] = useState("");
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [revenue, setRevenue] = useState<Line[]>([{ category: "FARES", description: "", amount: "" }]);
  const [expenses, setExpenses] = useState<Line[]>([{ category: "CHARGING", description: "", amount: "" }]);
  const [reserve, setReserve] = useState({ amount: "0", rationale: "维修与保险储备" });
  const project = pid || eligible[0]?.id || "";
  const r = sum(revenue);
  const e = sum(expenses);
  let res: bigint | null = null;
  try {
    res = parseUsdt(reserve.amount || "0");
  } catch {
    res = null;
  }
  const dist = r !== null && e !== null && res !== null ? r - e - res : null;
  const ok = !!project && !!usdt.data && !!period.start && !!period.end && period.start < period.end && dist !== null && dist >= 0n;
  return (
    <section className="panel" aria-labelledby="sub">
      <h2 id="sub">提交财务报告</h2>
      {eligible.length === 0 ? (
        <p className="empty">只有运营中的项目可以提交报告。</p>
      ) : (
        <div className="form">
          <div className="fgrid">
            <label className="field"><span>项目</span>
              <select value={project} onChange={(x) => setPid(x.target.value)}>{eligible.map((p) => <option key={p.id} value={p.id}>{projectName(p)}</option>)}</select>
            </label>
            <div className="fgrid">
              <label className="field"><span>期间开始</span><input type="date" value={period.start} onChange={(x) => setPeriod({ ...period, start: x.target.value })} /></label>
              <label className="field"><span>期间结束</span><input type="date" value={period.end} onChange={(x) => setPeriod({ ...period, end: x.target.value })} /></label>
            </div>
          </div>
          <LineEditor title="收入" lines={revenue} setLines={setRevenue} cats={["FARES", "INCENTIVES", "OTHER"]} />
          <LineEditor title="支出" lines={expenses} setLines={setExpenses} cats={["CHARGING", "MAINTENANCE", "INSURANCE", "PLATFORM_FEE", "CLEANING", "OTHER"]} />
          <div className="fgrid">
            <label className="field"><span>储备金额（USDT）</span><input value={reserve.amount} inputMode="decimal" onChange={(x) => setReserve({ ...reserve, amount: x.target.value })} /></label>
            <label className="field"><span>储备说明</span><input value={reserve.rationale} onChange={(x) => setReserve({ ...reserve, rationale: x.target.value })} /></label>
          </div>
          <div className="line tot"><span>可分配利润</span><b data-testid="distributable">{dist === null ? "—" : `${formatUsdt(dist)} USDT`}</b></div>
          <TxAction
            label="提交并把报告哈希上链"
            disabled={!ok}
            prepare={async () =>
              (
                await api.post<{ tx: PreparedTx }>("/admin/reports", {
                  projectId: project,
                  periodStart: period.start,
                  periodEnd: period.end,
                  paymentToken: usdt.data,
                  revenue: revenue.map((l) => ({ category: l.category, description: l.description, amount: parseUsdt(l.amount || "0").toString() })),
                  expenses: expenses.filter((l) => l.amount).map((l) => ({ category: l.category, description: l.description, amount: parseUsdt(l.amount).toString() })),
                  reserves: res && res > 0n ? [{ kind: "MAINTENANCE", amount: res.toString(), rationale: reserve.rationale }] : [],
                  distributableAmount: dist!.toString(),
                })
              ).tx
            }
            onDone={onDone}
          />
        </div>
      )}
    </section>
  );
}
