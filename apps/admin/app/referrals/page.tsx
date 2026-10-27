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
  city: { accrued: string; units: number; cap: string; remaining: string };
  topReferrers: { referrer: string; accrued: string }[];
}

/** Three-level referral programme (REFERRAL_DESIGN.md §10). Rewards are paid from platform fees only. */
export default function Referrals() {
  const { can } = useRoles();
  const refresh = useRefresh();
  const s = useQuery({ queryKey: ["admin", "referrals"], queryFn: () => api.get<Summary>("/admin/referrals") });
  const [prepared, setPrepared] = useState<{ requiredBalance: string; accounts: number } | null>(null);
  const d = s.data;
  const unpublished = d ? BigInt(d.totalAccrued) + BigInt(d.city.accrued) - BigInt(d.totalPublished) : 0n;
  return (
    <>
      <section className="panel" aria-labelledby="ref">
        <h2 id="ref">邀请奖励概况</h2>
        <div className="warnbox">
          三级邀请：被邀请人每期分润总额的 10%（直推）、5%（二级）、3%（三级），全部从平台 30% 分成里支付，不动投资者的 70%；较早发行、费率较低的项目，奖励总额不超过平台当期手续费。没有第四级。由平台手续费钱包充值到奖励合约后才能领取。主网开启前须由律师书面确认（多级奖励和按成交付佣金都有合规要求），开关默认关闭。
        </div>
        {s.error && <p className="err" role="alert">{errorText(s.error)}</p>}
        {d && (
          <div className="health" style={{ marginTop: 10 }}>
            <div><span>奖励合约</span><span className="mono">{d.contract ? shortAddr(d.contract) : "未部署或未索引"}</span></div>
            <div><span>邀请绑定</span><b>{d.bindings}</b></div>
            <div><span>被邀请人产生的手续费</span><b>{formatUsdt(d.totalFee)} USDT</b></div>
            <div><span>累计计提奖励</span><b>{formatUsdt(d.totalAccrued)} USDT</b></div>
            <div><span>城市奖励（团队长）</span><b data-testid="city-accrued">{formatUsdt(d.city.accrued)} USDT · {d.city.units} 份</b></div>
            <div><span>城市奖励剩余额度</span><b>{formatUsdt(d.city.remaining)} / {formatUsdt(d.city.cap)} USDT</b></div>
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
            <p className="muted small">按所有已计提奖励（含城市奖励）生成新的 Merkle 根（累计金额），由运营钱包签名上链。发布后请从平台手续费钱包向奖励合约转入差额。</p>
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
  const [days, setDays] = useState("365");
  const [proposal, setProposal] = useState<SafeProposal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function prepare() {
    setErr(null);
    setProposal(null);
    try {
      setProposal(await api.post<SafeProposal>("/admin/referrals/terms", { enabled, windowDays: Number(days) }));
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
          <label className="field"><span>绑定后有效天数</span><input value={days} inputMode="numeric" onChange={(e) => setDays(e.target.value)} /></label>
        </div>
        <p className="muted small">奖励比例 10% / 5% / 3% 写在代码里，这里只设开关和绑定后的奖励期；新奖励期只影响之后的新绑定。同时开关邀请绑定和奖励领取。</p>
        <div><button type="button" className="btn sm" onClick={prepare}>生成 Safe 提案</button></div>
        {err && <p className="err" role="alert">{err}</p>}
        {proposal && <ProposalView proposal={proposal} />}
      </div>
    </section>
  );
}
