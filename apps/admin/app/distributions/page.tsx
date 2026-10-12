"use client";
import { useQuery } from "@tanstack/react-query";
import { readContract } from "@wagmi/core";
import { useState } from "react";
import { erc20Abi, keccak256, stringToHex, type Address } from "viem";
import { revenueDistributorAbi } from "@roboshare/shared";
import { api, formatBps, formatUsdt, parseUsdt, shortAddr, useWalletConfig, type PreparedTx } from "@roboshare/ui";
import { TxAction } from "@/components/TxAction";
import { errorText, useAdminMe, useRoles } from "@/lib/admin";
import { projectName, useHealth, useProject, useProjects, useRefresh, useReports } from "@/lib/data";

interface Preview {
  pool: string;
  totalNet: string;
  totalFee: string;
  dustOut: string;
  carriedDustIn: string;
  allocations: { address: string; units: number; gross: string; feeBps: number; fee: string; net: string }[];
}

export default function Distributions() {
  const { can } = useRoles();
  const projects = useProjects();
  const active = (projects.data?.items ?? []).filter((p) => ["ACTIVE", "EXIT_PENDING", "TERMINATED"].includes(p.state));
  return (
    <>
      {can("OPERATOR") && <ProposeBatch projects={active.map((p) => ({ id: p.id, name: projectName(p), state: p.state }))} />}
      <section className="panel" aria-labelledby="pend">
        <h2 id="pend">待批准的分配批次</h2>
        {active.length === 0 && <p className="empty">没有运营中的项目。</p>}
        {active.map((p) => <PendingBatch key={p.id} id={p.id} name={projectName(p)} />)}
      </section>
    </>
  );
}

function ProposeBatch({ projects }: { projects: { id: string; name: string; state: string }[] }) {
  const [pid, setPid] = useState("");
  const project = pid || projects[0]?.id || "";
  // Fee-free return of capital (vehicle sale proceeds etc.) is only allowed once the term has ended.
  const canReturn = ["EXIT_PENDING", "TERMINATED"].includes(projects.find((p) => p.id === project)?.state ?? "");
  const [capital, setCapital] = useState(false);
  const capitalReturn = canReturn && capital;
  const approved = useReports("APPROVED");
  const health = useHealth();
  const reports = (approved.data?.items ?? []).filter((r) => r.projectIdOnchain === project && r.recordIdOnchain);
  const [rid, setRid] = useState("");
  const report = reports.find((r) => r.id === rid) ?? reports[0];
  const [amount, setAmount] = useState("");
  const [snap, setSnap] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [proposed, setProposed] = useState(false);
  const refresh = useRefresh();

  function body() {
    return {
      projectId: project,
      reportRecordId: report!.recordIdOnchain,
      amount: (amount ? parseUsdt(amount) : BigInt(report!.distributableAmount)).toString(),
      snapshotBlock: snap || health.data?.indexer?.lastBlock,
      ...(capitalReturn ? { capitalReturn: true } : {}),
    };
  }
  async function doPreview() {
    setErr(null);
    setPreview(null);
    setProposed(false);
    try {
      setPreview(await api.post<Preview>("/admin/distributions/preview", body()));
    } catch (e) {
      setErr(errorText(e));
    }
  }
  if (projects.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="prop">
      <h2 id="prop">提议分配批次</h2>
      <div className="form">
        <div className="fgrid">
          <label className="field"><span>项目</span>
            <select value={project} onChange={(e) => { setPid(e.target.value); setPreview(null); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className="field"><span>已批准的报告</span>
            <select value={report?.id ?? ""} onChange={(e) => { setRid(e.target.value); setPreview(null); }} disabled={!reports.length}>
              {reports.length === 0 && <option value="">没有已批准且已上链的报告</option>}
              {reports.map((r) => <option key={r.id} value={r.id}>{r.periodStart.slice(0, 10)} – {r.periodEnd.slice(0, 10)} · {formatUsdt(r.distributableAmount)} USDT</option>)}
            </select>
          </label>
          <label className="field"><span>本批金额（USDT，默认报告全额）</span><input value={amount} inputMode="decimal" placeholder={report ? formatUsdt(report.distributableAmount).replace(/,/g, "") : ""} onChange={(e) => { setAmount(e.target.value); setPreview(null); }} /></label>
          <label className="field"><span>快照区块（默认最新已索引区块）</span><input value={snap} inputMode="numeric" placeholder={health.data?.indexer?.lastBlock ?? ""} onChange={(e) => { setSnap(e.target.value); setPreview(null); }} /></label>
        </div>
        {canReturn && (
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={capital} onChange={(e) => { setCapital(e.target.checked); setPreview(null); }} />
            <span>到期返还本金（车辆出售款、储备金等，不收手续费）</span>
          </label>
        )}
        <div className="row">
          <button type="button" className="btn sm" disabled={!report} onClick={doPreview}>预览分配</button>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        {proposed && <p className="okmsg" role="status">批次已提议上链，等待另一位审核人批准后开放领取。</p>}
        {preview && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="tw">
              <table>
                <caption className="sr-only">分配预览</caption>
                <thead><tr><th>持有人</th><th className="r">份数</th><th className="r">毛额</th><th className="r">分成</th><th className="r">净额</th></tr></thead>
                <tbody>
                  {preview.allocations.map((a) => (
                    <tr key={a.address}>
                      <td className="mono">{shortAddr(a.address)}</td>
                      <td className="r">{a.units}</td>
                      <td className="r">{formatUsdt(a.gross)}</td>
                      <td className="r">{formatUsdt(a.fee)}（{formatBps(a.feeBps)}）</td>
                      <td className="r">{formatUsdt(a.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">合计净额 {formatUsdt(preview.totalNet)} · 运营方分成 {formatUsdt(preview.totalFee)} · 结转尾差 {preview.dustOut} wei。预览仅供核对，以合约计算为准。</p>
            <TxAction
              label={capitalReturn ? "提议本金返还批次（运营钱包签名）" : "提议批次（运营钱包签名）"}
              prepare={async () => (await api.post<{ tx: PreparedTx }>("/admin/distributions", body())).tx}
              onDone={() => { setPreview(null); setProposed(true); refresh(); }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function PendingBatch({ id, name }: { id: string; name: string }) {
  const config = useWalletConfig();
  const detail = useProject(id);
  const me = useAdminMe();
  const { can } = useRoles();
  const refresh = useRefresh();
  const [reason, setReason] = useState("");
  const distributor = detail.data?.contracts.distributor ?? undefined;
  const q = useQuery({
    queryKey: ["batch", distributor],
    enabled: !!distributor,
    refetchInterval: 5000,
    queryFn: async () => {
      const d = distributor as Address;
      const pending = (await readContract(config, { address: d, abi: revenueDistributorAbi, functionName: "pendingBatchId" })) as bigint;
      if (pending === 0n) return null;
      const b = (await readContract(config, { address: d, abi: revenueDistributorAbi, functionName: "getBatch", args: [pending] })) as {
        amount: bigint; pool: bigint; totalNet: bigint; totalFee: bigint; snapshotBlock: bigint; proposer: Address; capitalReturn?: boolean;
      };
      const [token, treasury] = await Promise.all([
        readContract(config, { address: d, abi: revenueDistributorAbi, functionName: "paymentToken" }) as Promise<Address>,
        readContract(config, { address: d, abi: revenueDistributorAbi, functionName: "treasury" }) as Promise<Address>,
      ]);
      const allowance = await readContract(config, { address: token, abi: erc20Abi, functionName: "allowance", args: [treasury, d] });
      const balance = await readContract(config, { address: token, abi: erc20Abi, functionName: "balanceOf", args: [treasury] });
      return { id: pending, b, treasury, funded: allowance >= b.amount && balance >= b.amount };
    },
  });
  if (!q.data) return null;
  const { b } = q.data;
  const self = me.data?.wallet.toLowerCase() === b.proposer.toLowerCase();
  return (
    <div className="q" data-testid={`batch-${id}`}>
      <span className="ic" aria-hidden="true">#{q.data.id.toString()}</span>
      <div>
        <h3 className="h4">{name} · 第 {q.data.id.toString()} 批{b.capitalReturn ? "（本金返还，免手续费）" : ""} · {formatUsdt(b.amount)} USDT</h3>
        <small>投资者净额 {formatUsdt(b.totalNet)} · 运营方分成 {formatUsdt(b.totalFee)} · 快照区块 {b.snapshotBlock.toString()} · 提议人 {shortAddr(b.proposer)}</small>
        <small className={q.data.funded ? "c-good" : "c-warn"}>
          资金账户 {shortAddr(q.data.treasury)} {q.data.funded ? "已备足并授权" : "余额或授权不足，批准会失败"}
        </small>
      </div>
      {can("REVIEWER") && !self ? (
        <div className="stack" style={{ gap: 6, justifyItems: "end" }}>
          <TxAction
            label="批准并开放领取"
            className="btn good sm"
            disabled={!q.data.funded}
            prepare={async () => [{ label: `批准第 ${q.data!.id} 批`, write: { address: distributor!, abi: revenueDistributorAbi, functionName: "approveBatch", args: [q.data!.id] } }]}
            onDone={refresh}
          />
          <label className="field" style={{ minWidth: 180 }}>
            <span className="sr-only">驳回原因</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="驳回原因" />
          </label>
          <TxAction
            label="驳回"
            className="btn danger sm"
            disabled={reason.trim().length < 3}
            prepare={async () => [{ label: `驳回第 ${q.data!.id} 批`, write: { address: distributor!, abi: revenueDistributorAbi, functionName: "rejectBatch", args: [q.data!.id, keccak256(stringToHex(reason))] } }]}
            onDone={refresh}
          />
        </div>
      ) : (
        <span className="lab">{self ? "提议人不能批准自己的批次" : "需审核角色"}</span>
      )}
    </div>
  );
}
