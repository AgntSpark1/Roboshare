"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { maxUint256, erc20Abi, type Hash } from "viem";
import { subscriptionRouterAbi } from "@roboshare/shared";
import {
  api,
  countdown,
  formatUsdt,
  shortAddr,
  TxProgress,
  useAccount,
  useChainNow,
  useSession,
  useTxRunner,
  WalletButton,
  type ProjectDetail,
  type TxStep,
} from "@roboshare/ui";
import { explorer, RISK_VERSION } from "@/env";
import { useEligibility, useMySubscriptions, usePaymentSetup, useRefreshAfterTx, useUsdtState } from "@/lib/data";
import { useI18n } from "@/i18n/I18nProvider";
import { zhCN, type Messages } from "@/i18n/messages/zh-CN";
import { storedReferrer, useReferralsEnabled } from "@/lib/referral";

type Purpose = "APPROVE" | "SUBSCRIBE";

/** Why the buy button is disabled, in the order an investor would fix things. Exported for tests. */
export function blockReason(input: {
  connected: boolean;
  signedIn: boolean;
  open: boolean;
  eligible: boolean | undefined;
  remaining: number;
  units: number;
  balance: bigint | undefined;
  cost: bigint;
  acknowledged: boolean;
}, m: Messages["subscribe"]["block"] = zhCN.subscribe.block): string | null {
  if (!input.open) return m.closed;
  if (!input.connected) return m.connect;
  if (!input.signedIn) return m.signIn;
  if (input.eligible === false) return m.ineligible;
  if (input.remaining <= 0) return m.limit;
  if (input.units < 1 || input.units > input.remaining) return m.range(input.remaining);
  if (input.balance !== undefined && input.balance < input.cost) return m.balance;
  if (!input.acknowledged) return m.ack;
  return null;
}

export function SubscribePanel({ p }: { p: ProjectDetail }) {
  const o = p.offering!;
  const { t } = useI18n();
  const c = t.subscribe;
  const { address, isConnected } = useAccount();
  const { me } = useSession();
  const elig = useEligibility();
  const subs = useMySubscriptions();
  const pay = usePaymentSetup();
  const usdt = useUsdtState(address);
  const refresh = useRefreshAfterTx();
  const { run, start, reset } = useTxRunner();
  const [units, setUnits] = useState(1);
  const [ack, setAck] = useState(false);
  const [unlimited, setUnlimited] = useState(true);
  const [done, setDone] = useState(false);
  const referralsOn = useReferralsEnabled().data === true;
  // Read on render: the invite was stored when the visitor landed. Binding happens on chain, once.
  const referrer = referralsOn ? storedReferrer(address) : null;
  const firstPurchase = subs.data !== undefined && subs.data.items.length === 0;

  const now = useChainNow();
  const open = p.state === "OFFERING" && o.status === "OPEN" && now >= new Date(o.startAt ?? 0).getTime() && now < new Date(o.endAt).getTime();
  const mine = (subs.data?.items ?? []).filter((s) => s.projectId === p.id && s.status === "ESCROWED").reduce((n, s) => n + s.units, 0);
  const remaining = Math.max(0, Math.min((o.perWalletMax ?? o.maxUnits) - mine, o.maxUnits - o.unitsSold));
  const price = BigInt(o.unitPrice);
  const cost = price * BigInt(units);
  const needApproval = usdt.data ? usdt.data.allowance < cost : true;

  const reason = blockReason({
    connected: isConnected,
    signedIn: !!me,
    open,
    eligible: elig.data?.eligibleNow,
    remaining,
    units,
    balance: usdt.data?.balance,
    cost,
    acknowledged: ack,
  }, c.block);

  const steps = useMemo<(TxStep & { purpose: Purpose })[]>(() => {
    if (!pay.router || !pay.usdt) return [];
    const s: (TxStep & { purpose: Purpose })[] = [];
    if (needApproval) {
      s.push({
        label: unlimited ? c.stepApproveUnlimited : c.stepApprove(formatUsdt(cost)),
        purpose: "APPROVE",
        write: { address: pay.usdt, abi: erc20Abi, functionName: "approve", args: [pay.router, unlimited ? maxUint256 : cost] },
      });
    }
    s.push({
      label: c.stepBuy(units),
      purpose: "SUBSCRIBE",
      write: referrer
        ? { address: pay.router, abi: subscriptionRouterAbi, functionName: "subscribeWithReferrer", args: [p.id, units, cost, referrer] }
        : { address: pay.router, abi: subscriptionRouterAbi, functionName: "subscribe", args: [p.id, units, cost] },
    });
    return s;
  }, [pay.router, pay.usdt, needApproval, unlimited, cost, units, p.id, referrer, c]);

  async function buy() {
    reset();
    setDone(false);
    await api.post("/me/risk-acknowledgement", { version: RISK_VERSION });
    const ok = await start(steps, (hash: Hash, i: number) => {
      void api.post("/tx/pending", { hash, purpose: steps[i]!.purpose }).catch(() => undefined);
    });
    if (ok) {
      setDone(true);
      refresh();
    }
  }

  const set = (n: number) => setUnits(Math.max(1, Math.min(Math.max(remaining, 1), Math.floor(n) || 1)));

  return (
    <aside className="buy" aria-label={c.aria}>
      <div className="line">
        <span className="muted">{c.unitPrice}</span>
        <b>{formatUsdt(o.unitPrice)} USDT</b>
      </div>
      {open && (
        <div className="line">
          <span className="muted">{c.timeLeft}</span>
          <b className="mono">{countdown(o.endAt, now, t.ui.days)}</b>
        </div>
      )}
      <div>
        <label htmlFor="units" className="muted" style={{ fontSize: ".8rem" }}>{c.unitsLabel(remaining)}</label>
        <div className="stepper" style={{ marginTop: 6 }}>
          <button type="button" aria-label={c.less} onClick={() => set(units - 1)} disabled={units <= 1}>−</button>
          <input id="units" inputMode="numeric" value={units} onChange={(e) => set(Number(e.target.value))} />
          <button type="button" aria-label={c.more} onClick={() => set(units + 1)} disabled={units >= remaining}>+</button>
        </div>
      </div>
      <div className="line total">
        <span>{c.due}</span>
        <b>{formatUsdt(cost)} USDT</b>
      </div>
      {address && usdt.data && (
        <div className={`approval${needApproval ? "" : " ok"}`}>
          <span className="st" aria-hidden="true" />
          {c.balance(formatUsdt(usdt.data.balance))}{needApproval ? "" : c.direct}
        </div>
      )}
      {needApproval && isConnected && me && (
        <div className="warnbox">
          <span>{c.approvalWarn}</span>
          <div className="radio" role="radiogroup" aria-label={c.approvalAria}>
            <label><input type="radio" name="allow" checked={unlimited} onChange={() => setUnlimited(true)} /> {c.unlimited}</label>
            <label><input type="radio" name="allow" checked={!unlimited} onChange={() => setUnlimited(false)} /> {c.once(formatUsdt(cost))}</label>
          </div>
        </div>
      )}
      {referrer && firstPurchase && (
        <p className="muted" style={{ fontSize: ".78rem" }} data-testid="referrer-note">
          {c.referrer} <span className="mono">{shortAddr(referrer)}</span> · {c.referrerNote}
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          {c.ackBefore}<Link href="/risk" style={{ color: "var(--amber)" }}>{t.layout.investorNotes}</Link>{c.ackAfter}
        </span>
      </label>
      {!isConnected || !me ? (
        <WalletButton signInLabel={c.signInToBuy} />
      ) : (
        <button type="button" className="btn primary" disabled={!!reason || run.running || steps.length === 0} onClick={buy}>
          {run.running ? <span className="spin" aria-hidden="true" /> : null}
          {needApproval ? c.approveAndBuy : c.confirm}
        </button>
      )}
      {reason && <p className="muted" style={{ fontSize: ".8rem" }} data-testid="block-reason">{reason}</p>}
      {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
      {done && (
        <p className="okmsg" role="status">
          {c.success}<Link href="/portfolio">{t.project.viewPortfolio}</Link>
        </p>
      )}
      <p className="fine">{c.fine(o.minUnits, o.perWalletMax ?? o.maxUnits)}</p>
    </aside>
  );
}
