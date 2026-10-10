"use client";
import { useState } from "react";
import { shortAddr, type PreparedTx, type TimelockProposal } from "@roboshare/ui";

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

/** A timelock proposal for the 2/3 governance Safe. Nothing is sent from here; signers propose it in the Safe. */
export function ProposalView({ proposal }: { proposal: TimelockProposal }) {
  return (
    <div className="panel stack" data-testid="proposal">
      <div className="warnbox">
        这是交给治理 Safe（3 人中 2 人签名）的时间锁提案。在 Safe 里新建交易并粘贴下面的地址和 calldata；schedule 执行后需等待 {Math.round(proposal.delaySeconds / 3600)} 小时，才能执行 execute。本页面不会发送任何交易。
      </div>
      <TxBlock title="1. schedule（现在提交）" tx={proposal.schedule} />
      <TxBlock title="2. execute（时间锁到期后）" tx={proposal.execute} />
      <p className="muted small">salt {proposal.salt}</p>
    </div>
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
