"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatUsdt, parseUsdt } from "@roboshare/ui";
import { errorText, useRoles } from "@/lib/admin";
import { projectName, useProjects } from "@/lib/data";

interface DailyRow {
  day: string;
  revenue: string;
  expenses: string;
  rides: number | null;
  note: string | null;
}

const beijingToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** Daily operating revenue per vehicle. The website shows it as pending; the autopilot pays each month out. */
export default function Daily() {
  const projects = useProjects();
  const { can } = useRoles();
  const qc = useQueryClient();
  const running = (projects.data?.items ?? []).filter((p) => ["ACTIVE", "EXIT_PENDING", "SUSPENDED"].includes(p.state));
  const [pid, setPid] = useState("");
  const project = pid || running[0]?.id || "";
  const [month, setMonth] = useState(beijingToday().slice(0, 7));
  const [f, setF] = useState({ day: beijingToday(), revenue: "", expenses: "", rides: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ["admin", "daily", project, month],
    enabled: !!project,
    queryFn: () => api.get<{ items: DailyRow[]; totals: { revenue: string; expenses: string; days: number } }>(`/admin/autopilot/daily/${project}?month=${month}`),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      await api.put(`/admin/autopilot/daily/${project}`, {
        day: f.day,
        revenue: parseUsdt(f.revenue || "0").toString(),
        expenses: parseUsdt(f.expenses || "0").toString(),
        rides: f.rides ? Number(f.rides) : undefined,
        note: f.note || undefined,
      });
      setOk(`${f.day} 已保存`);
      setF({ ...f, revenue: "", expenses: "", rides: "", note: "" });
      await qc.invalidateQueries({ queryKey: ["admin", "daily"] });
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  if (!running.length) return <section className="panel"><p className="empty">还没有运营中的车辆。</p></section>;
  const t = list.data?.totals;
  return (
    <>
      <section className="panel" aria-labelledby="in">
        <h2 id="in">录入每日运营数据</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>按北京时间日期录入。网站会把它显示为“待结算”收入，每月 2 日自动汇总上个月并分配给投资者。已经汇总进月报的日期不能再改。</p>
        {!can("OPERATOR") ? (
          <p className="empty">录入需要运营角色。</p>
        ) : (
          <form className="form" onSubmit={save}>
            <div className="fgrid">
              <label className="field"><span>车辆</span>
                <select value={project} onChange={(e) => setPid(e.target.value)}>{running.map((p) => <option key={p.id} value={p.id}>{projectName(p)}</option>)}</select>
              </label>
              <label className="field"><span>日期</span><input type="date" value={f.day} max={beijingToday()} onChange={set("day")} /></label>
              <label className="field"><span>当日收入（USDT）</span><input value={f.revenue} onChange={set("revenue")} inputMode="decimal" placeholder="0" /></label>
              <label className="field"><span>当日支出（USDT，充电/清洁/保险等）</span><input value={f.expenses} onChange={set("expenses")} inputMode="decimal" placeholder="0" /></label>
              <label className="field"><span>订单数（可选）</span><input value={f.rides} onChange={set("rides")} inputMode="numeric" /></label>
              <label className="field"><span>备注（可选）</span><input value={f.note} onChange={set("note")} /></label>
            </div>
            <div><button type="submit" className="btn primary sm" disabled={busy || !project || !f.revenue}>保存</button></div>
            {ok && <p className="okmsg" role="status">{ok}</p>}
            {err && <p className="err" role="alert">{err}</p>}
          </form>
        )}
      </section>
      <section className="panel" aria-labelledby="mo">
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 id="mo">本月记录</h2>
          <span className="spacer" />
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="月份" />
        </div>
        {t && <p className="small" style={{ marginBottom: 8 }}>{t.days} 天 · 收入 <b>{formatUsdt(t.revenue)}</b> · 支出 <b>{formatUsdt(t.expenses)}</b> · 净收益 <b>{formatUsdt((BigInt(t.revenue) - BigInt(t.expenses)).toString())}</b> USDT</p>}
        {!list.data?.items.length ? (
          <p className="empty">这个月还没有记录。</p>
        ) : (
          <div className="tw">
            <table>
              <thead><tr><th>日期</th><th className="r">收入</th><th className="r">支出</th><th className="r">订单</th><th>备注</th></tr></thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.day}>
                    <td>{r.day.slice(0, 10)}</td>
                    <td className="r">{formatUsdt(r.revenue)}</td>
                    <td className="r">{formatUsdt(r.expenses)}</td>
                    <td className="r">{r.rides ?? "—"}</td>
                    <td>{r.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
