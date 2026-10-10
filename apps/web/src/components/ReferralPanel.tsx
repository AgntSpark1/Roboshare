"use client";
import { useState } from "react";
import type { Hash } from "viem";
import { referralRewardsAbi } from "@roboshare/shared";
import { api, formatBps, formatUsdt, shortAddr, TxProgress, useTxRunner, type TxStep } from "@roboshare/ui";
import { explorer } from "@/env";
import { useRefreshAfterTx } from "@/lib/data";
import { inviteLink, useMyReferrals, useReferralsEnabled } from "@/lib/referral";

/** Single-tier invite programme: rewards come out of the platform fee, never out of investors' money. */
export function ReferralPanel({ wallet }: { wallet: `0x${string}` }) {
  const enabled = useReferralsEnabled();
  const refs = useMyReferrals();
  const { run, start } = useTxRunner();
  const refresh = useRefreshAfterTx();
  const [copied, setCopied] = useState(false);
  const r = refs.data;
  // Hidden until governance switches the programme on and the reward contract is indexed.
  if (enabled.data !== true || !r?.contract) return null;

  const link = typeof window === "undefined" ? "" : inviteLink(window.location.origin, wallet);
  const share = r.referees[0]?.shareBps ?? 2_000;
  const steps: TxStep[] = r.claimable
    ? [{ label: "领取邀请奖励", write: { address: r.contract, abi: referralRewardsAbi, functionName: "claim", args: [wallet, BigInt(r.claimable.cumulative), r.claimable.proof] } }]
    : [];
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  async function claim() {
    const ok = await start(steps, (hash: Hash) => void api.post("/tx/pending", { hash, purpose: "REFERRAL_CLAIM" }).catch(() => undefined));
    if (ok) refresh();
  }
  return (
    <div className="panel" data-testid="referral-panel">
      <h2 className="h3">邀请奖励</h2>
      <p className="muted" style={{ fontSize: ".82rem" }}>
        朋友通过你的链接首次认购后，在之后的期限内，平台从他每期分配所收手续费中拿出 {formatBps(share)} 给你，按 USDT 结算。只有一层邀请，朋友再邀请别人与你无关。奖励来自平台手续费，不影响朋友的收益。你需要保持投资资格有效才能获得奖励。
      </p>
      <div className="row-actions" style={{ margin: "10px 0" }}>
        <span className="hash" data-testid="invite-link">{link}</span>
        <button type="button" className="btn ghost sm" onClick={copy}>{copied ? "已复制" : "复制邀请链接"}</button>
      </div>
      {r.referredBy && (
        <p className="muted" style={{ fontSize: ".8rem" }}>你的邀请人：<span className="mono">{shortAddr(r.referredBy.referrer)}</span></p>
      )}
      <div className="health">
        <div><span>已邀请</span><b>{r.referees.length} 人</b></div>
        <div><span>累计奖励</span><b>{formatUsdt(r.earned)} USDT</b></div>
        <div><span>已领取</span><b>{formatUsdt(r.claimed)} USDT</b></div>
        <div><span>等待平台发布</span><b>{formatUsdt(r.pendingPublication)} USDT</b></div>
      </div>
      {r.referees.map((x) => (
        <div className="tl" key={x.wallet}>
          <i aria-hidden="true" />
          <span className="mono">{shortAddr(x.wallet)}</span>
          <span>奖励 {formatUsdt(x.earned)} USDT · 到期 {new Date(x.expiresAt).toLocaleDateString("zh-CN")}</span>
        </div>
      ))}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary sm" disabled={!r.claimable || run.running || run.states[0] === "done"} onClick={claim}>
          {r.claimable ? `领取 ${formatUsdt(r.claimable.amount)} USDT` : "暂无可领取奖励"}
        </button>
      </div>
      {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
    </div>
  );
}
