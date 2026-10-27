"use client";
import { formatDate, formatUsdt, shortAddr } from "@roboshare/ui";
import { Copy } from "@/components/Proposal";
import { teamLink, WEB_URL } from "@/env";

export interface TeamInfo {
  id: string;
  code: string;
  name: string;
  leader: string;
  note: string | null;
  createdAt: string;
}

export interface TeamDetail {
  team: TeamInfo;
  totals: { members: number; investors: number; invested: string; rewards: string; fee: string; city: string; cityUnits: number };
  members: { wallet: string; depth: number; invitedBy: string | null; joinedAt: string | null; invites: number; invested: string; rewards: string; fee: string; city: string; cityUnits: number }[];
}

export function TeamLink({ code }: { code: string }) {
  const link = teamLink(code);
  return (
    <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <span className="mono" data-testid="team-link">{link}</span>
      {WEB_URL && <Copy text={link} label="复制链接" />}
    </span>
  );
}

const DEPTH = (d: number) => (d === 0 ? "团队长" : `第 ${d} 代`);

/** Totals and the member list of one team: the same view for staff and for the team leader. */
export function TeamView({ d }: { d: TeamDetail }) {
  const t = d.totals;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="health">
        <div><span>团队码</span><b className="mono">{d.team.code}</b></div>
        <div><span>团队链接</span><TeamLink code={d.team.code} /></div>
        <div><span>团队长</span><span className="mono">{shortAddr(d.team.leader)}</span></div>
        <div><span>成员（含团队长）</span><b>{t.members}</b></div>
        <div><span>已认购人数</span><b>{t.investors}</b></div>
        <div><span>团队认购额</span><b>{formatUsdt(t.invested)} USDT</b></div>
        <div><span>成员产生的平台手续费</span><b>{formatUsdt(t.fee)} USDT</b></div>
        <div><span>成员累计邀请奖励</span><b>{formatUsdt(t.rewards)} USDT</b></div>
        <div><span>团队长城市奖励</span><b data-testid="team-city">{formatUsdt(t.city)} USDT · {t.cityUnits} 份</b></div>
      </div>
      {d.members.length === 0 ? (
        <p className="empty">还没有成员。</p>
      ) : (
        <div className="tw">
          <table>
            <caption className="sr-only">团队成员</caption>
            <thead>
              <tr><th>钱包</th><th>层级</th><th>邀请人</th><th>加入时间</th><th className="r">直接邀请</th><th className="r">认购额（USDT）</th><th className="r">邀请奖励（USDT）</th><th className="r">城市奖励（USDT）</th></tr>
            </thead>
            <tbody>
              {d.members.map((m) => (
                <tr key={m.wallet}>
                  <td className="mono">{shortAddr(m.wallet)}</td>
                  <td>{DEPTH(m.depth)}</td>
                  <td className="mono">{m.invitedBy ? shortAddr(m.invitedBy) : "—"}</td>
                  <td>{m.joinedAt ? formatDate(m.joinedAt) : "—"}</td>
                  <td className="r">{m.invites}</td>
                  <td className="r">{formatUsdt(m.invested)}</td>
                  <td className="r">{formatUsdt(m.rewards)}</td>
                  <td className="r">{formatUsdt(m.city)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
