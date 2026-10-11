"use client";
import { useState } from "react";
import type { Hash } from "viem";
import { referralRewardsAbi } from "@roboshare/shared";
import { api, formatBps, formatUsdt, shortAddr, TxProgress, useTxRunner, type TxStep } from "@roboshare/ui";
import { explorer } from "@/env";
import { useI18n } from "@/i18n/I18nProvider";
import { useRefreshAfterTx } from "@/lib/data";
import { inviteLink, useMyReferrals, useReferralsEnabled } from "@/lib/referral";

/** Single-tier invite programme: rewards come out of the platform fee, never out of investors' money. */
export function ReferralPanel({ wallet }: { wallet: `0x${string}` }) {
  const { t, locale } = useI18n();
  const c = t.referral;
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
    ? [{ label: c.claimStep, write: { address: r.contract, abi: referralRewardsAbi, functionName: "claim", args: [wallet, BigInt(r.claimable.cumulative), r.claimable.proof] } }]
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
      <h2 className="h3">{c.title}</h2>
      <p className="muted" style={{ fontSize: ".82rem" }}>
        {c.intro(formatBps(share))}
      </p>
      <div className="row-actions" style={{ margin: "10px 0" }}>
        <span className="hash" data-testid="invite-link">{link}</span>
        <button type="button" className="btn ghost sm" onClick={copy}>{copied ? c.copied : c.copy}</button>
      </div>
      {r.referredBy && (
        <p className="muted" style={{ fontSize: ".8rem" }}>{c.referredBy}<span className="mono">{shortAddr(r.referredBy.referrer)}</span></p>
      )}
      <div className="health">
        <div><span>{c.invited}</span><b>{c.people(r.referees.length)}</b></div>
        <div><span>{c.earned}</span><b>{formatUsdt(r.earned)} USDT</b></div>
        <div><span>{c.claimed}</span><b>{formatUsdt(r.claimed)} USDT</b></div>
        <div><span>{c.pending}</span><b>{formatUsdt(r.pendingPublication)} USDT</b></div>
      </div>
      {r.referees.map((x) => (
        <div className="tl" key={x.wallet}>
          <i aria-hidden="true" />
          <span className="mono">{shortAddr(x.wallet)}</span>
          <span>{c.row(formatUsdt(x.earned), new Date(x.expiresAt).toLocaleDateString(locale))}</span>
        </div>
      ))}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary sm" disabled={!r.claimable || run.running || run.states[0] === "done"} onClick={claim}>
          {r.claimable ? c.claim(formatUsdt(r.claimable.amount)) : c.none}
        </button>
      </div>
      {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
    </div>
  );
}
