"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@roboshare/ui";
import { TeamView, type TeamDetail } from "@/components/TeamView";
import { errorText } from "@/lib/admin";

/** Team leader back office: read-only, the signed-in leader's own team only. */
export default function Leader() {
  const q = useQuery({ queryKey: ["team", "me"], retry: false, queryFn: () => api.get<TeamDetail>("/team/me") });
  if (q.isLoading) return <p className="muted">加载中…</p>;
  if (q.error) {
    const notLeader = q.error instanceof ApiError && q.error.code === "NOT_TEAM_LEADER";
    return <p className="err" role="alert">{notLeader ? "这个钱包不是团队长。请用平台登记的团队长钱包登录。" : errorText(q.error)}</p>;
  }
  const d = q.data!;
  return (
    <section className="panel" aria-labelledby="team">
      <h2 id="team">{d.team.name}</h2>
      <p className="muted small">
        把团队链接发给新投资者。他们第一次认购时会在链上永久记在你的团队下；成员再邀请的人也归入你的团队。邀请奖励按平台三级规则计算，在投资者网站"推广"页由本人领取。
      </p>
      <TeamView d={d} />
    </section>
  );
}
