"use client";
import Link from "next/link";
import { useState } from "react";
import { shortAddr, type PreparedTx, type SafeProposal } from "@roboshare/ui";

function Copy({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          setOk(false);
        }
      }}
    >
      {ok ? "已复制" : label}
    </button>
  );
}

function TxBlock({ title, tx }: { title: string; tx: PreparedTx }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <b>{title}</b>
        <span className="muted small">to {shortAddr(tx.to)} · value 0</span>
        <span className="spacer" />
        <Copy text={tx.to} label="复制地址" />
        <Copy text={tx.data} label="复制 calldata" />
      </div>
      <div className="calldata">{tx.data}</div>
    </div>
  );
}

/**
 * A governance action for the 2/3 Safe. There is no timelock: it takes effect as soon as two owners sign and
 * execute it. Nothing is sent from here.
 */
export function ProposalView({ proposal }: { proposal: SafeProposal }) {
  const batch = proposal.calls.length > 1;
  if (proposal.queueId) {
    return (
      <div className="panel stack" data-testid="proposal">
        <p className="okmsg" role="status">已提交到“多签待签”。多签 owner 在后台确认，够人数后执行，执行后立即生效。</p>
        <div><Link className="btn primary sm" href="/safe">去确认</Link></div>
        <details>
          <summary className="muted small">手动在 Safe 网页里签（备用）</summary>
          <div className="stack" style={{ marginTop: 8 }}><ManualProposal proposal={proposal} batch={batch} /></div>
        </details>
      </div>
    );
  }
  return (
    <div className="panel stack" data-testid="proposal">
      <ManualProposal proposal={proposal} batch={batch} />
    </div>
  );
}

function ManualProposal({ proposal, batch }: { proposal: SafeProposal; batch: boolean }) {
  return (
    <>
      <div className="warnbox">
        这是交给治理 Safe（{shortAddr(proposal.safe)}，3 人中 2 人签名）的操作，签够 2 人并执行后<b>立即生效</b>，没有等待期，请核对无误再签。
        {batch ? `在 Safe 的 Transaction Builder 里按顺序添加下面 ${proposal.calls.length} 笔调用（会合并成一笔交易）。` : "在 Safe 里新建交易，粘贴下面的地址和 calldata。"}
        本页面不会发送任何交易。
      </div>
      {proposal.calls.map((c, i) => (
        <TxBlock key={i} title={batch ? `${i + 1}. ${c.description}` : c.description} tx={{ ...proposal.tx, to: c.to, data: c.data, description: c.description }} />
      ))}
      {batch && (
        <details>
          <summary className="muted small">合并后的单笔 Safe 交易（MultiSendCallOnly，operation 1，供脚本使用）</summary>
          <TxBlock title={proposal.tx.description} tx={proposal.tx} />
        </details>
      )}
    </>
  );
}

/** Several direct transactions for a role holder (e.g. the Guardian's pause set). */
export function PreparedList({ txs }: { txs: PreparedTx[] }) {
  return (
    <div className="panel stack">
      {txs.map((t, i) => (
        <TxBlock key={i} title={t.description} tx={t} />
      ))}
    </div>
  );
}
