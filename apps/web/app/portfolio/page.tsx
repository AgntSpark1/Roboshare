"use client";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { erc20Abi, type Hash } from "viem";
import { offeringManagerAbi, revenueDistributorAbi } from "@roboshare/shared";
import {
  api,
  formatBps,
  formatUsdt,
  shortAddr,
  stateLabel,
  TxProgress,
  useAccount,
  useChainNow,
  useSession,
  useTxRunner,
  WalletButton,
  type ProjectDetail,
  type TxStep,
} from "@roboshare/ui";
import { explorer } from "@/env";
import { useEligibility, useMySubscriptions, usePaymentSetup, useRefreshAfterTx, useUsdtState } from "@/lib/data";
import { ReferralPanel } from "@/components/ReferralPanel";

interface Holding {
  projectId: string;
  units: number;
  issuedUnits: number;
  shareBps: number;
  costBasis: string | null;
}
interface MyDistribution {
  projectId: string;
  batchId: number;
  units: number;
  gross: string;
  feeBps: number;
  fee: string;
  net: string;
  claimed: boolean;
  claimTxHash: string | null;
}
interface MyTx {
  kind: string;
  chain: { txHash: string; blockNumber: string };
}

const TX_LABEL: Record<string, string> = { MINT: "获得份额", TRANSFER_IN: "转入份额", TRANSFER_OUT: "转出份额", SUBSCRIBE: "认购", REFUND: "退款", CLAIM: "领取分配" };

export default function Portfolio() {
  const { isConnected } = useAccount();
  const { me, loading } = useSession();
  if (!isConnected || !me) {
    return (
      <section>
        <div className="wrap">
          <div className="sec-h"><h1 className="h2">我的资产</h1></div>
          <div className="panel empty">
            <p>{loading ? "正在检查登录状态…" : "连接钱包后，查看你的份额和收益。"}</p>
            <WalletButton />
          </div>
        </div>
      </section>
    );
  }
  return <Dashboard />;
}

function Dashboard() {
  const { me } = useSession();
  const wallet = me!.wallet;
  const holdings = useQuery({ queryKey: ["me", "portfolio", wallet], queryFn: () => api.get<{ items: Holding[] }>("/me/portfolio") });
  const dists = useQuery({ queryKey: ["me", "distributions", wallet], queryFn: () => api.get<{ items: MyDistribution[] }>("/me/distributions") });
  const subs = useMySubscriptions();
  const txs = useQuery({ queryKey: ["me", "transactions", wallet], queryFn: () => api.get<{ items: MyTx[]; pending: { hash: string; purpose: string }[] }>("/me/transactions") });
  const elig = useEligibility();
  const ids = [...new Set([...(holdings.data?.items ?? []).map((h) => h.projectId), ...(subs.data?.items ?? []).map((s) => s.projectId), ...(dists.data?.items ?? []).map((d) => d.projectId)])];
  const details = useQueries({ queries: ids.map((id) => ({ queryKey: ["project", id], queryFn: () => api.get<ProjectDetail>(`/projects/${id}`) })) });
  const project = (id: string) => details.find((d) => d.data?.id === id)?.data;
  const name = (id: string) => project(id)?.meta?.title ?? shortAddr(id);

  const claimable = (dists.data?.items ?? []).filter((d) => !d.claimed);
  const totalClaimable = claimable.reduce((s, d) => s + BigInt(d.net), 0n);
  const totalClaimed = (dists.data?.items ?? []).filter((d) => d.claimed).reduce((s, d) => s + BigInt(d.net), 0n);
  const totalUnits = (holdings.data?.items ?? []).reduce((s, h) => s + h.units, 0);

  return (
    <section>
      <div className="wrap stack">
        <div className="sec-h">
          <h1 className="h2">我的资产</h1>
          <p>
            钱包 <span className="mono">{shortAddr(wallet)}</span> · 认购资格：
            {elig.data ? (elig.data.eligibleNow ? <span className="ok-t"> 有效</span> : <span className="warn-t"> 未开通</span>) : " —"}
          </p>
        </div>
        <div className="tiles">
          <div className="tile hl"><span className="eyebrow">可领取</span><span className="num" data-testid="claimable-total">{formatUsdt(totalClaimable)}</span><small className="muted">USDT</small></div>
          <div className="tile"><span className="eyebrow">已领取</span><span className="num">{formatUsdt(totalClaimed)}</span><small className="muted">USDT</small></div>
          <div className="tile"><span className="eyebrow">持有份额</span><span className="num">{totalUnits}</span><small className="muted">份 · {holdings.data?.items.length ?? 0} 个项目</small></div>
        </div>

        <div className="panel">
          <h2 className="h3">可领取收益</h2>
          {claimable.length === 0 ? (
            <p className="muted">暂时没有可领取的收益。</p>
          ) : (
            claimable.map((d) => (
              <ClaimRow key={`${d.projectId}-${d.batchId}`} d={d} name={name(d.projectId)} distributor={project(d.projectId)?.contracts.distributor ?? null} />
            ))
          )}
        </div>

        <div className="cols2">
          <div className="panel">
            <h2 className="h3">持有份额</h2>
            {(holdings.data?.items ?? []).length === 0 ? (
              <p className="muted">还没有份额。<Link href="/projects" style={{ color: "var(--amber)" }}>去看看车辆项目</Link></p>
            ) : (
              holdings.data!.items.map((h) => (
                <div className="hold" key={h.projectId}>
                  <span className="ic" aria-hidden="true">🚕</span>
                  <div>
                    <h3 className="h4"><Link href={`/projects/${h.projectId}`}>{name(h.projectId)}</Link></h3>
                    <small>{stateLabel(project(h.projectId)?.state ?? "")} · 占已发行 {formatBps(h.shareBps)}</small>
                  </div>
                  <div className="r"><b className="num">{h.units}</b> 份<br /><small>成本 {h.costBasis ? formatUsdt(h.costBasis) : "—"}</small></div>
                </div>
              ))
            )}
          </div>
          <div className="panel">
            <h2 className="h3">认购记录</h2>
            {(subs.data?.items ?? []).length === 0 ? (
              <p className="muted">还没有认购记录。</p>
            ) : (
              subs.data!.items.map((s) => (
                <SubscriptionRow key={s.projectId} s={s} name={name(s.projectId)} project={project(s.projectId)} />
              ))
            )}
          </div>
        </div>

        <ReferralPanel wallet={wallet} />

        <div className="cols2">
          <ApprovalPanel wallet={wallet} />
          <div className="panel">
            <h2 className="h3">交易记录</h2>
            {(txs.data?.pending ?? []).map((t) => (
              <div className="tl new" key={t.hash}><i aria-hidden="true" /><span>{t.purpose} · 等待确认</span><span className="hash">{shortAddr(t.hash, 8, 6)}</span></div>
            ))}
            {(txs.data?.items ?? []).slice(0, 12).map((t, i) => (
              <div className="tl" key={`${t.chain.txHash}-${i}`}>
                <i aria-hidden="true" />
                <span>{TX_LABEL[t.kind] ?? t.kind}</span>
                {explorer ? <a className="hash" href={`${explorer}/tx/${t.chain.txHash}`} target="_blank" rel="noreferrer">{shortAddr(t.chain.txHash, 8, 6)}</a> : <span className="hash">{shortAddr(t.chain.txHash, 8, 6)}</span>}
              </div>
            ))}
            {!txs.data?.items.length && !txs.data?.pending.length && <p className="muted">暂无记录。</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function ClaimRow({ d, name, distributor }: { d: MyDistribution; name: string; distributor: `0x${string}` | null }) {
  const { run, start } = useTxRunner();
  const refresh = useRefreshAfterTx();
  const steps: TxStep[] = distributor
    ? [{ label: `领取 ${name} 第 ${d.batchId} 批`, write: { address: distributor, abi: revenueDistributorAbi, functionName: "claim", args: [BigInt(d.batchId)] } }]
    : [];
  async function claim() {
    const ok = await start(steps, (hash: Hash) => void api.post("/tx/pending", { hash, purpose: "CLAIM" }).catch(() => undefined));
    if (ok) refresh();
  }
  const finished = run.states[0] === "done";
  return (
    <div className="claim">
      <div>
        <b>{name} · 第 {d.batchId} 批</b>
        <div className="breakdown">
          持有 {d.units} 份 · 毛额 {formatUsdt(d.gross)} − 运营方分成 {formatUsdt(d.fee)}（{formatBps(d.feeBps)}）= 净额 <b>{formatUsdt(d.net)} USDT</b>
        </div>
        {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
      </div>
      <button type="button" className="btn primary sm" disabled={!distributor || run.running || finished} onClick={claim}>
        {finished ? "已领取" : `领取 ${formatUsdt(d.net)} USDT`}
      </button>
    </div>
  );
}

function SubscriptionRow({ s, name, project }: { s: { projectId: string; units: number; amount: string; status: string; refundAvailable: boolean }; name: string; project?: ProjectDetail }) {
  const { run, start } = useTxRunner();
  const refresh = useRefreshAfterTx();
  const now = useChainNow();
  const offering = project?.contracts.offering ?? null;
  const o = project?.offering;
  // Anyone may finalize a failed offering after its end; then each subscriber claims their refund.
  const failedButOpen = !!o && o.status === "OPEN" && now >= new Date(o.endAt).getTime() && o.unitsSold < o.minUnits;
  const steps: TxStep[] = !offering
    ? []
    : [
        ...(failedButOpen ? [{ label: "确认募集失败", write: { address: offering, abi: offeringManagerAbi, functionName: "finalizeFailed" } }] : []),
        { label: "领取退款", write: { address: offering, abi: offeringManagerAbi, functionName: "claimRefund" } },
      ];
  const STATUS: Record<string, string> = { ESCROWED: "托管中", SETTLED: "已结算", REFUNDABLE: "可退款", REFUNDED: "已退款" };
  const canRefund = s.status === "REFUNDABLE" || (s.status === "ESCROWED" && failedButOpen);
  return (
    <div className="q">
      <div>
        <h3 className="h4">{name}</h3>
        <small>{s.units} 份 · {formatUsdt(s.amount)} USDT · {STATUS[s.status] ?? s.status}</small>
        {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
      </div>
      {canRefund && (
        <button type="button" className="btn lidar sm" disabled={!offering || run.running} onClick={async () => (await start(steps, (hash: Hash) => void api.post("/tx/pending", { hash, purpose: "REFUND" }).catch(() => undefined))) && refresh()}>
          领取退款
        </button>
      )}
    </div>
  );
}

function ApprovalPanel({ wallet }: { wallet: `0x${string}` }) {
  const pay = usePaymentSetup();
  const st = useUsdtState(wallet);
  const { run, start } = useTxRunner();
  const refresh = useRefreshAfterTx();
  const [confirm, setConfirm] = useState(false);
  const allowance = st.data?.allowance ?? 0n;
  const unlimited = allowance > 10n ** 60n;
  const steps: TxStep[] = pay.usdt && pay.router ? [{ label: "撤销 USDT 授权", write: { address: pay.usdt, abi: erc20Abi, functionName: "approve", args: [pay.router, 0n] } }] : [];
  return (
    <div className="panel">
      <h2 className="h3">USDT 授权</h2>
      <div className="health">
        <div><span>认购合约</span><span className="hash">{shortAddr(pay.router)}</span></div>
        <div><span>当前授权额度</span><b data-testid="allowance">{st.data ? (unlimited ? "不限额" : `${formatUsdt(allowance)} USDT`) : "—"}</b></div>
        <div><span>钱包余额</span><b>{st.data ? `${formatUsdt(st.data.balance)} USDT` : "—"}</b></div>
      </div>
      {allowance > 0n && (
        <div className="row-actions" style={{ marginTop: 12 }}>
          {!confirm ? (
            <button type="button" className="btn danger sm" onClick={() => setConfirm(true)}>撤销授权</button>
          ) : (
            <>
              <span className="muted" style={{ fontSize: ".8rem" }}>撤销后，下次认购需要重新授权。</span>
              <button type="button" className="btn danger sm" disabled={run.running} onClick={async () => (await start(steps, (hash: Hash) => void api.post("/tx/pending", { hash, purpose: "REVOKE_APPROVAL" }).catch(() => undefined))) && (setConfirm(false), refresh())}>
                确认撤销
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setConfirm(false)}>取消</button>
            </>
          )}
        </div>
      )}
      {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
    </div>
  );
}

