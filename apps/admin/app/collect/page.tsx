"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";
import { api, shortAddr, type SafeProposal } from "@roboshare/ui";
import { ProposalView } from "@/components/Proposal";
import { errorText, useRoles } from "@/lib/admin";
import { projectName, useProjects } from "@/lib/data";

interface WalletRow {
  wallet: `0x${string}`;
  subscriptions: number;
  units: number;
}

const RECOVERY_HINT = "建议使用治理或收款 Safe 的地址，不要使用个人钱包。";

export default function Collect() {
  const { can } = useRoles();
  const projects = useProjects();
  const withContracts = (projects.data?.items ?? []).filter((p) => !["NONE", "DRAFT", "VERIFIED"].includes(p.state));

  // ---- pull (wallet collect) ----
  const wallets = useQuery({
    queryKey: ["admin", "collect", "wallets"],
    queryFn: () => api.get<{ items: WalletRow[] }>("/admin/collect/wallets"),
  });
  const [pullTo, setPullTo] = useState("");
  const [source, setSource] = useState<"router" | "market">("router");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [pullProposal, setPullProposal] = useState<SafeProposal | null>(null);
  const [pullErr, setPullErr] = useState<string | null>(null);

  const extraList = extra
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const invalidExtra = extraList.find((s) => !isAddress(s));
  const pullFroms = [...checked, ...(invalidExtra ? [] : extraList)];

  async function preparePull() {
    setPullErr(null);
    setPullProposal(null);
    try {
      const r = await api.post<{ proposal: SafeProposal }>("/admin/collect/pull", {
        to: pullTo,
        source,
        froms: pullFroms,
        reason: `console collect: ${source} allowances`,
      });
      setPullProposal(r.proposal);
    } catch (e) {
      setPullErr(errorText(e));
    }
  }

  // ---- sweep (pool collect) ----
  const [sweepTo, setSweepTo] = useState("");
  const [pools, setPools] = useState({ router: false, market: false, referral: false });
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set());
  const [sweepProposal, setSweepProposal] = useState<SafeProposal | null>(null);
  const [sweepErr, setSweepErr] = useState<string | null>(null);

  const anyPool = pools.router || pools.market || pools.referral || projectIds.size > 0;
  async function prepareSweep() {
    setSweepErr(null);
    setSweepProposal(null);
    try {
      const r = await api.post<{ proposal: SafeProposal }>("/admin/collect/sweep", {
        to: sweepTo,
        router: pools.router,
        market: pools.market,
        referral: pools.referral,
        projectIds: [...projectIds],
        reason: "console collect: pools",
      });
      setSweepProposal(r.proposal);
    } catch (e) {
      setSweepErr(errorText(e));
    }
  }

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  if (!can("GOV_VIEW") && !can("OPERATOR") && !can("REVIEWER")) {
    return (
      <section className="panel" aria-labelledby="c">
        <h2 id="c">USDT 归集</h2>
        <p className="empty">需要员工角色登录（含 TOTP）。</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel" aria-labelledby="c0">
        <h2 id="c0">USDT 归集（治理应急权限）</h2>
        <div className="warnbox">
          这里生成的是治理 Safe（3 人中 2 人签名、执行后立即生效）的归集交易：从投资者钱包划走其仍授权给合约的全部 USDT，或把各资金池的 USDT 余额一次性转入指定地址。正常运营不应使用；钱包内未授权给合约的 USDT 与份额代币不受影响。详见风险披露。
        </div>
      </section>

      <section className="panel" aria-labelledby="c1">
        <h2 id="c1">用户钱包归集（pullUsdt）</h2>
        {!can("GOV_VIEW") ? (
          <p className="empty">需要治理角色。</p>
        ) : (
          <div className="form">
            <div className="fgrid">
              <label className="field">
                <span>授权来源合约</span>
                <select value={source} onChange={(e) => setSource(e.target.value as "router" | "market")}>
                  <option value="router">认购授权（SubscriptionRouter）</option>
                  <option value="market">买盘授权（ShareMarket）</option>
                </select>
              </label>
              <label className="field">
                <span>归集到（指定钱包地址）</span>
                <input value={pullTo} onChange={(e) => setPullTo(e.target.value)} placeholder="0x…" className="mono" />
              </label>
            </div>
            <p className="muted small">{RECOVERY_HINT}执行时按每个钱包的 min(剩余授权, 钱包余额) 划走，不记录认购。</p>

            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>投资者钱包（来自认购记录）</b>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setChecked(new Set((wallets.data?.items ?? []).map((w) => w.wallet)))}
                >
                  全选
                </button>
                <button type="button" className="btn sm" onClick={() => setChecked(new Set())}>
                  清空
                </button>
              </div>
            </div>
            <div className="tw">
              <table>
                <thead>
                  <tr><th></th><th>钱包</th><th>认购笔数</th><th>份额</th></tr>
                </thead>
                <tbody>
                  {(wallets.data?.items ?? []).map((w) => (
                    <tr key={w.wallet}>
                      <td style={{ width: 28 }}>
                        <input
                          type="checkbox"
                          checked={checked.has(w.wallet)}
                          onChange={() => setChecked((prev) => toggle(prev, w.wallet))}
                          aria-label={`选择 ${shortAddr(w.wallet)}`}
                        />
                      </td>
                      <td className="mono">{shortAddr(w.wallet, 10, 8)}</td>
                      <td>{w.subscriptions}</td>
                      <td>{w.units}</td>
                    </tr>
                  ))}
                  {!wallets.data?.items.length && (
                    <tr><td colSpan={4} className="empty">暂无认购记录。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <label className="field">
              <span>追加钱包地址（可粘贴多行/逗号分隔；这些钱包须已对上述合约授权，否则执行时该笔划转失败）</span>
              <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} className="mono" placeholder="0x…&#10;0x…" />
            </label>
            {invalidExtra && <p className="err" role="alert">无效地址：{invalidExtra}</p>}
            <div>
              <button
                type="button"
                className="btn danger sm"
                disabled={!isAddress(pullTo) || pullFroms.length === 0 || !!invalidExtra}
                onClick={preparePull}
              >
                生成归集交易（{pullFroms.length} 个钱包）
              </button>
            </div>
            {pullErr && <p className="err" role="alert">{pullErr}</p>}
            {pullProposal && <ProposalView proposal={pullProposal} />}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="c2">
        <h2 id="c2">资金池归集（sweepUsdt）</h2>
        {!can("GOV_VIEW") ? (
          <p className="empty">需要治理角色。</p>
        ) : (
          <div className="form">
            <label className="field">
              <span>归集到（指定钱包地址）</span>
              <input value={sweepTo} onChange={(e) => setSweepTo(e.target.value)} placeholder="0x…" className="mono" />
            </label>
            <p className="muted small">{RECOVERY_HINT}托管与分配账目保留；补足资金后退款/领取照常。</p>
            <div className="fgrid">
              <label className="field"><span>平台资金池</span>
                <div className="stack" style={{ gap: 4 }}>
                  <label><input type="checkbox" checked={pools.router} onChange={() => setPools((p) => ({ ...p, router: !p.router }))} /> 认购路由余额（通常为 0，误转入的 USDT）</label>
                  <label><input type="checkbox" checked={pools.market} onChange={() => setPools((p) => ({ ...p, market: !p.market }))} /> 二手市场余额（通常为 0，误转入的 USDT）</label>
                  <label><input type="checkbox" checked={pools.referral} onChange={() => setPools((p) => ({ ...p, referral: !p.referral }))} /> 推荐奖励池（平台充值的待领奖励）</label>
                </div>
              </label>
              <label className="field"><span>项目资金池（募集托管款 / 待领取分配额）</span>
                <div className="stack" style={{ gap: 4, maxHeight: 180, overflowY: "auto" }}>
                  {withContracts.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={projectIds.has(p.id)}
                        onChange={() => setProjectIds((prev) => toggle(prev, p.id))}
                      />{" "}
                      {projectName(p)}（托管 + 分配池）
                    </label>
                  ))}
                  {!withContracts.length && <span className="muted small">暂无已部署合约的项目。</span>}
                </div>
              </label>
            </div>
            <div>
              <button type="button" className="btn danger sm" disabled={!isAddress(sweepTo) || !anyPool} onClick={prepareSweep}>
                生成归集交易
              </button>
            </div>
            {sweepErr && <p className="err" role="alert">{sweepErr}</p>}
            {sweepProposal && <ProposalView proposal={sweepProposal} />}
          </div>
        )}
      </section>
    </>
  );
}
