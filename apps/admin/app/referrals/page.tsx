"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatUsdt, shortAddr, type PreparedTx, type SafeProposal } from "@roboshare/ui";
import { ProposalView } from "@/components/Proposal";
import { TxAction } from "@/components/TxAction";
import { errorText, useRoles } from "@/lib/admin";
import { useRefresh } from "@/lib/data";

interface Summary {
  contract: string | null;
  bindings: number;
  totalFee: string;
  totalAccrued: string;
  latestRoot: { epoch: number; root: string; totalCumulative: string; txHash: string } | null;
  totalPublished: string;
  totalClaimed: string;
  outstanding: string;
  topReferrers: { referrer: string; accrued: string }[];
}

/** Single-tier referral programme (REFERRAL_DESIGN.md). Rewards are paid from platform fees only. */
export default function Referrals() {
  const { can } = useRoles();
  const refresh = useRefresh();
  const s = useQuery({ queryKey: ["admin", "referrals"], queryFn: () => api.get<Summary>("/admin/referrals") });
  const [prepared, setPrepared] = useState<{ requiredBalance: string; accounts: number } | null>(null);
  const d = s.data;
  const unpublished = d ? BigInt(d.totalAccrued) - BigInt(d.totalPublished) : 0n;
  return (
    <>
      <section className="panel" aria-labelledby="ref">
        <h2 id="ref">邀请奖励概况</h2>
        <div className="warnbox">
          两级邀请：一级 = 被邀请人每期分配中平台手续费的一部分，二级 = 邀请人的邀请人再得同一笔手续费的 5%，没有第三级；由平台手续费钱包充值到奖励合约后才能领取。主网开启前须完成法律审查（多级返佣有传销风险，按成交付佣金可能构成无牌经纪）。
        </div>
        {s.error && <p className="err" role="alert">{errorText(s.error)}</p>}
        {d && (
          <div className="health" style={{ marginTop: 10 }}>
            <div><span>奖励合约</span><span className="mono">{d.contract ? shortAddr(d.contract) : "未部署或未索引"}</span></div>
            <div><span>邀请绑定</span><b>{d.bindings}</b></div>
            <div><span>被邀请人产生的手续费</span><b>{formatUsdt(d.totalFee)} USDT</b></div>
            <div><span>累计计提奖励</span><b>{formatUsdt(d.totalAccrued)} USDT</b></div>
            <div><span>已发布（最新根）</span><b>{formatUsdt(d.totalPublished)} USDT{d.latestRoot ? ` · 第 ${d.latestRoot.epoch} 期` : ""}</b></div>
            <div><span>已领取</span><b>{formatUsdt(d.totalClaimed)} USDT</b></div>
            <div><span>合约至少需持有</span><b data-testid="outstanding">{formatUsdt(d.outstanding)} USDT</b></div>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="pub">
        <h2 id="pub">发布奖励根</h2>
        {!can("OPERATOR") ? (
          <p className="empty">需要运营角色。</p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <p className="muted small">按所有已计提奖励生成新的 Merkle 根（累计金额），由运营钱包签名上链。发布后请从平台手续费钱包向奖励合约转入差额。</p>
            <p>待发布：<b>{formatUsdt(unpublished > 0n ? unpublished : 0n)} USDT</b></p>
            <TxAction
              label="生成并发布奖励根（运营钱包签名）"
              disabled={unpublished <= 0n}
              prepare={async () => {
                const r = await api.post<{ tx: PreparedTx; requiredBalance: string; accounts: number }>("/admin/referrals/root", {});
                setPrepared({ requiredBalance: r.requiredBalance, accounts: r.accounts });
                return r.tx;
              }}
              onDone={refresh}
            />
            {prepared && (
              <p className="okmsg" role="status">
                新根覆盖 {prepared.accounts} 个邀请人。奖励合约余额需不少于 {formatUsdt(prepared.requiredBalance)} USDT，所有人才能领取。
              </p>
            )}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="top">
        <h2 id="top">邀请人排行</h2>
        {(d?.topReferrers ?? []).length === 0 ? (
          <p className="empty">还没有计提的奖励。</p>
        ) : (
          <div className="tw">
            <table>
              <caption className="sr-only">邀请人累计奖励</caption>
              <thead><tr><th>邀请人</th><th className="r">累计奖励（USDT）</th></tr></thead>
              <tbody>
                {d!.topReferrers.map((r) => (
                  <tr key={r.referrer}><td className="mono">{shortAddr(r.referrer)}</td><td className="r">{formatUsdt(r.accrued)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {can("GOV_VIEW") && <TermsProposal />}
    </>
  );
}

function TermsProposal() {
  const [enabled, setEnabled] = useState(false);
  const [share, setShare] = useState("20");
  const [days, setDays] = useState("365");
  const [proposal, setProposal] = useState<SafeProposal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function prepare() {
    setErr(null);
    setProposal(null);
    try {
      setProposal(await api.post<SafeProposal>("/admin/referrals/terms", { enabled, shareBps: Math.round(Number(share) * 100), windowDays: Number(days) }));
    } catch (e) {
      setErr(errorText(e));
    }
  }
  return (
    <section className="panel" aria-labelledby="terms">
      <h2 id="terms">开关与条款（治理提案）</h2>
      <div className="form">
        <div className="fgrid">
          <label className="field"><span>状态</span>
            <select value={enabled ? "on" : "off"} onChange={(e) => setEnabled(e.target.value === "on")}>
              <option value="off">关闭</option>
              <option value="on">开启</option>
            </select>
          </label>
          <label className="field"><span>手续费分成比例（%，最高 50）</span><input value={share} inputMode="decimal" onChange={(e) => setShare(e.target.value)} /></label>
          <label className="field"><span>绑定后有效天数</span><input value={days} inputMode="numeric" onChange={(e) => setDays(e.target.value)} /></label>
        </div>
        <p className="muted small">新条款只影响之后的新绑定。同时开关邀请绑定和奖励领取。</p>
        <div><button type="button" className="btn sm" onClick={prepare}>生成 Safe 提案</button></div>
        {err && <p className="err" role="alert">{err}</p>}
        {proposal && <ProposalView proposal={proposal} />}
      </div>
    </section>
  );
}
