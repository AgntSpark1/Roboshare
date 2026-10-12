"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatDate, shortAddr, useAccount, useWalletConfig, type TxStep } from "@roboshare/ui";
import { zeroAddress, type Address, type Hex } from "viem";
import { TxAction } from "@/components/TxAction";
import { explorer } from "@/env";
import { errorText, useRoles } from "@/lib/admin";
import { approvalsOf, nextNonce, preValidatedSignatures, readSafe, safeAbi, safeTxHash, safeTxTitle, usePendingSafeTxs, type QueuedSafeTx, type SafeState } from "@/lib/safe";

export default function SafeQueue() {
  const pending = usePendingSafeTxs();
  const history = useQuery({ queryKey: ["admin", "safe-txs", "history"], queryFn: () => api.get<{ items: QueuedSafeTx[] }>("/admin/safe-txs?status=all") });
  const config = useWalletConfig();
  const items = pending.data?.items ?? [];
  const safeAddr = items[0]?.safe;
  const safe = useQuery({ queryKey: ["safe-state", safeAddr], enabled: !!safeAddr, refetchInterval: 10_000, queryFn: () => readSafe(config, safeAddr as Address) });
  const sorted = [...items].sort((a, b) => (a.safeNonce ?? Infinity) - (b.safeNonce ?? Infinity) || a.createdAt.localeCompare(b.createdAt));
  const done = (history.data?.items ?? []).filter((t) => t.status !== "PENDING").slice(0, 20);
  return (
    <>
      <section className="panel" aria-labelledby="sq">
        <h2 id="sq">待签多签交易</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>
          用多签 owner 钱包在这里确认。确认人数够了（{safe.data ? `${safe.data.owners.length} 人中 ${safe.data.threshold} 人` : "3 人中 2 人"}）后，最后一位 owner 点“执行”，交易立即生效，没有等待期。最后一位 owner 可以直接点“确认并执行”，少签一次。
        </p>
        {pending.error && <p className="err" role="alert">{errorText(pending.error)}</p>}
        {!pending.isLoading && sorted.length === 0 && <p className="empty">没有待签交易。</p>}
        {sorted.map((t) => <QueueItem key={t.id} t={t} safe={safe.data} all={items} />)}
        {safe.data && (
          <div className="health" style={{ marginTop: 12 }}>
            <div><span>多签地址</span><span className="mono">{shortAddr(safeAddr)}</span></div>
            <div><span>owner</span><span className="mono">{safe.data.owners.map((o) => shortAddr(o)).join(" · ")}</span></div>
            <div><span>当前编号（nonce）</span><span className="mono">{safe.data.nonce}</span></div>
          </div>
        )}
      </section>
      <section className="panel" aria-labelledby="sh">
        <h2 id="sh">最近完成</h2>
        {done.length === 0 && <p className="empty">暂无记录。</p>}
        {done.map((t) => (
          <div className="q" key={t.id}>
            <span className="ic" aria-hidden="true">{t.status === "EXECUTED" ? "✓" : "✕"}</span>
            <div>
              <h3 className="h4">{safeTxTitle(t.description)}</h3>
              <small>
                {t.status === "EXECUTED" ? "已执行" : `已作废：${t.closeReason ?? ""}`} · {formatDate(t.closedAt)}
                {t.execTxHash && explorer && <> · <a href={`${explorer}/tx/${t.execTxHash}`} target="_blank" rel="noreferrer">查看交易</a></>}
              </small>
            </div>
            <span />
          </div>
        ))}
      </section>
    </>
  );
}

function QueueItem({ t, safe, all }: { t: QueuedSafeTx; safe: SafeState | undefined; all: QueuedSafeTx[] }) {
  const config = useWalletConfig();
  const { address: me } = useAccount();
  const { can } = useRoles();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "safe-txs"] });
    void qc.invalidateQueries({ queryKey: ["safe-state"] });
    void qc.invalidateQueries({ queryKey: ["safe-approvals"] });
  };
  const stale = !!safe && t.safeNonce !== null && t.safeNonce < safe.nonce;
  const sig = useQuery({
    queryKey: ["safe-approvals", t.id, t.safeNonce, safe?.nonce],
    enabled: !!safe && t.safeNonce !== null && !stale,
    refetchInterval: 10_000,
    queryFn: async () => {
      const hash = await safeTxHash(config, t, t.safeNonce!);
      return { hash, approved: await approvalsOf(config, t.safe, safe!.owners, hash) };
    },
  });
  if (!safe) return <div className="q"><span className="ic">…</span><div>{safeTxTitle(t.description)}</div><span /></div>;

  const approved = sig.data?.approved ?? [];
  const isOwner = !!me && safe.owners.some((o) => o.toLowerCase() === me.toLowerCase());
  const iApproved = !!me && approved.some((a) => a.toLowerCase() === me.toLowerCase());
  const nonce = t.safeNonce ?? nextNonce(safe.nonce, all);
  const isNext = nonce === safe.nonce;
  const execSigs = preValidatedSignatures(approved, me, safe.owners, safe.threshold);
  const canExec = isNext && !stale && !!execSigs && (isOwner || approved.length >= safe.threshold);
  const blockedBy = !isNext && !stale ? all.find((o) => o.safeNonce === safe.nonce) : undefined;

  /** Fixes the nonce on first use, then returns the hash every owner confirms. */
  async function numbered(): Promise<Hex> {
    if (t.safeNonce === null) await api.post(`/admin/safe-txs/${t.id}/nonce`, { nonce });
    return safeTxHash(config, t, nonce);
  }
  async function confirmSteps(): Promise<TxStep[]> {
    const hash = await numbered();
    return [{ label: "确认这笔多签交易（approveHash）", write: { address: t.safe, abi: safeAbi, functionName: "approveHash", args: [hash] } }];
  }
  async function execSteps(): Promise<TxStep[]> {
    const hash = await numbered();
    const fresh = await approvalsOf(config, t.safe, safe!.owners, hash);
    const signatures = preValidatedSignatures(fresh, me, safe!.owners, safe!.threshold);
    if (!signatures) throw new Error("确认人数还不够，刷新后再试。");
    return [{
      label: "执行多签交易（立即生效）",
      write: { address: t.safe, abi: safeAbi, functionName: "execTransaction", args: [t.to, 0n, t.data, t.operation, 0n, 0n, 0n, zeroAddress, zeroAddress, signatures] },
    }];
  }
  async function cancel() {
    const reason = window.prompt("作废原因（记入审计日志）");
    if (!reason || reason.trim().length < 2) return;
    setErr(null);
    try {
      await api.post(`/admin/safe-txs/${t.id}/cancel`, { reason: reason.trim() });
      refresh();
    } catch (e) {
      setErr(errorText(e));
    }
  }
  async function renumber() {
    if (!window.confirm("这笔交易的编号已被其他多签交易用掉。确定它还没有执行过、需要重新签？如果已经执行过，请点“作废”。")) return;
    setErr(null);
    try {
      await api.post(`/admin/safe-txs/${t.id}/renumber`);
      refresh();
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <div className="q" data-testid={`safe-tx-${t.id}`}>
      <span className="ic" aria-hidden="true">{t.safeNonce === null ? "签" : `#${t.safeNonce}`}</span>
      <div className="stack" style={{ gap: 4 }}>
        <h3 className="h4">{safeTxTitle(t.description)}</h3>
        <small>
          {stale
            ? "编号已被其他交易用掉"
            : t.safeNonce === null
              ? `还没有人确认 · 需要 ${safe.threshold} 人`
              : `已确认 ${approved.length} / ${safe.threshold}${approved.length ? `（${approved.map((a) => shortAddr(a)).join("、")}）` : ""}`}
          {blockedBy && ` · 需先执行 #${safe.nonce}`}
          {" · "}提交人 {shortAddr(t.createdBy)} · {formatDate(t.createdAt)}
        </small>
        <details>
          <summary className="muted small">查看调用明细（{t.calls.length} 笔）</summary>
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            {t.calls.map((c, i) => (
              <div key={i} className="small">
                <b>{i + 1}. {c.description}</b> <span className="muted">→ {shortAddr(c.to)}</span>
                <div className="calldata">{c.data}</div>
              </div>
            ))}
          </div>
        </details>
        {err && <p className="err" role="alert">{err}</p>}
      </div>
      <div className="stack" style={{ gap: 6, justifyItems: "end" }}>
        {stale ? (
          <button type="button" className="btn sm" onClick={renumber}>重新排号</button>
        ) : canExec ? (
          <TxAction
            label={isOwner && !iApproved && approved.length < safe.threshold ? "确认并执行" : "执行"}
            className="btn good sm"
            confirm={`执行「${safeTxTitle(t.description)}」？执行后立即生效。`}
            prepare={execSteps}
            onDone={async (h) => {
              await api.post(`/admin/safe-txs/${t.id}/executed`, { txHash: h[0] });
              refresh();
            }}
          />
        ) : isOwner && !iApproved ? (
          <TxAction label="确认" prepare={confirmSteps} onDone={refresh} />
        ) : (
          <span className="lab">{!me ? "未连接钱包" : iApproved ? "你已确认，等待其他 owner" : "当前钱包不是多签 owner"}</span>
        )}
        {can("GOV_VIEW", "OPERATOR") && <button type="button" className="btn danger sm" onClick={cancel}>作废</button>}
      </div>
    </div>
  );
}
