"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatUsdt, shortAddr } from "@roboshare/ui";
import { TeamLink, TeamView, type TeamDetail, type TeamInfo } from "@/components/TeamView";
import { errorText, useRoles } from "@/lib/admin";

interface TeamRow extends TeamInfo {
  leaderSubscribed: boolean;
  members: number;
  investors: number;
  invested: string;
  rewards: string;
  fee: string;
}

/**
 * Promotion teams (REFERRAL_DESIGN.md §9): grouping for reporting only. Members follow the on-chain
 * invite bindings under the leader; rewards stay the two-level referral rewards from one treasury.
 */
export default function Teams() {
  const { can } = useRoles();
  const list = useQuery({ queryKey: ["admin", "teams"], queryFn: () => api.get<{ items: TeamRow[] }>("/admin/teams") });
  const [open, setOpen] = useState<string | null>(null);
  const items = list.data?.items ?? [];
  return (
    <>
      <section className="panel" aria-labelledby="teams">
        <h2 id="teams">推广团队</h2>
        <p className="muted small">
          每个团队有一个团队长钱包和团队链接。投资者第一次认购时在链上永久绑定邀请人，团队长和成员邀请来的人都自动归入同一团队，不会串队。所有奖励仍按两级邀请规则，从同一个奖励合约统一发放。团队长用自己的钱包登录本控制台的"团队后台"（/leader）只读查看本团队数据。
        </p>
        {list.error && <p className="err" role="alert">{errorText(list.error)}</p>}
        {items.length === 0 ? (
          <p className="empty">还没有团队。</p>
        ) : (
          <div className="tw">
            <table>
              <caption className="sr-only">推广团队</caption>
              <thead>
                <tr><th>团队</th><th>团队长</th><th className="r">成员</th><th className="r">已认购</th><th className="r">认购额（USDT）</th><th className="r">邀请奖励（USDT）</th><th /></tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.name}</b> <span className="lab mono">{t.code}</span></td>
                    <td className="mono">
                      {shortAddr(t.leader)}
                      {!t.leaderSubscribed && <span className="lab" title="链上只接受认购过的钱包作为邀请人">未认购，链接暂不生效</span>}
                    </td>
                    <td className="r">{t.members}</td>
                    <td className="r">{t.investors}</td>
                    <td className="r">{formatUsdt(t.invested)}</td>
                    <td className="r">{formatUsdt(t.rewards)}</td>
                    <td><button type="button" className="btn sm" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "收起" : "查看"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && <TeamPanel id={open} canEdit={can("OPERATOR")} />}
      {can("OPERATOR") && <CreateTeam />}
    </>
  );
}

function TeamPanel({ id, canEdit }: { id: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "teams", id], queryFn: () => api.get<TeamDetail>(`/admin/teams/${id}`) });
  const [name, setName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function rename(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api.put(`/admin/teams/${id}`, { name });
      setName(null);
      await qc.invalidateQueries({ queryKey: ["admin", "teams"] });
    } catch (x) {
      setErr(errorText(x));
    }
  }
  return (
    <section className="panel" aria-labelledby="team-detail">
      <h2 id="team-detail">{q.data ? q.data.team.name : "团队详情"}</h2>
      {q.error && <p className="err" role="alert">{errorText(q.error)}</p>}
      {q.data && <TeamView d={q.data} />}
      {q.data && canEdit && (
        <form className="form" onSubmit={rename} style={{ marginTop: 12 }}>
          <label className="field"><span>团队名称</span><input value={name ?? q.data.team.name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
          <div><button type="submit" className="btn sm" disabled={!name || name === q.data.team.name}>保存名称</button></div>
          <p className="muted small">团队码和团队长创建后不能修改，保证链接和成员归属稳定。</p>
          {err && <p className="err" role="alert">{err}</p>}
        </form>
      )}
    </section>
  );
}

function CreateTeam() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [leader, setLeader] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setDone(null);
    try {
      const t = await api.post<TeamInfo>("/admin/teams", { code, name, leader: leader.trim(), ...(note ? { note } : {}) });
      setDone(t.code);
      setCode("");
      setName("");
      setLeader("");
      setNote("");
      await qc.invalidateQueries({ queryKey: ["admin", "teams"] });
    } catch (x) {
      setErr(errorText(x));
    }
  }
  return (
    <section className="panel" aria-labelledby="new-team">
      <h2 id="new-team">新建团队</h2>
      <form className="form" onSubmit={create}>
        <div className="fgrid">
          <label className="field"><span>团队码（2–16 位字母或数字）</span><input value={code} maxLength={16} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></label>
          <label className="field"><span>团队名称</span><input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>团队长钱包地址</span><input value={leader} className="mono" placeholder="0x…" onChange={(e) => setLeader(e.target.value)} /></label>
          <label className="field"><span>备注（可选，仅内部可见）</span><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <p className="muted small">团队长钱包必须没有被其他团队邀请过，否则会被拒绝（防止抢别人的成员）。团队长需要自己先认购至少一次，链上才接受他作为邀请人。</p>
        <div><button type="submit" className="btn primary sm" disabled={code.length < 2 || !name || !leader}>创建团队</button></div>
        {err && <p className="err" role="alert">{err}</p>}
        {done && <p className="okmsg" role="status">已创建，团队链接：<TeamLink code={done} /></p>}
      </form>
    </section>
  );
}
