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
}): string | null {
  if (!input.open) return "当前不在募集期";
  if (!input.connected) return "请先连接钱包";
  if (!input.signedIn) return "请先签名登录";
  if (input.eligible === false) return "你的钱包还没有通过投资资格认证";
  if (input.remaining <= 0) return "你已达到本项目的认购上限，或份额已售罄";
  if (input.units < 1 || input.units > input.remaining) return `可认购 1–${input.remaining} 份`;
  if (input.balance !== undefined && input.balance < input.cost) return "USDT 余额不足";
  if (!input.acknowledged) return "请先勾选风险确认";
  return null;
}

export function SubscribePanel({ p }: { p: ProjectDetail }) {
  const o = p.offering!;
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
  });

  const steps = useMemo<(TxStep & { purpose: Purpose })[]>(() => {
    if (!pay.router || !pay.usdt) return [];
    const s: (TxStep & { purpose: Purpose })[] = [];
    if (needApproval) {
      s.push({
        label: unlimited ? "授权 USDT（不限额）" : `授权 ${formatUsdt(cost)} USDT`,
        purpose: "APPROVE",
        write: { address: pay.usdt, abi: erc20Abi, functionName: "approve", args: [pay.router, unlimited ? maxUint256 : cost] },
      });
    }
    s.push({
      label: `认购 ${units} 份`,
      purpose: "SUBSCRIBE",
      write: referrer
        ? { address: pay.router, abi: subscriptionRouterAbi, functionName: "subscribeWithReferrer", args: [p.id, units, cost, referrer] }
        : { address: pay.router, abi: subscriptionRouterAbi, functionName: "subscribe", args: [p.id, units, cost] },
    });
    return s;
  }, [pay.router, pay.usdt, needApproval, unlimited, cost, units, p.id, referrer]);

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
    <aside className="buy" aria-label="认购">
      <div className="line">
        <span className="muted">每份价格</span>
        <b>{formatUsdt(o.unitPrice)} USDT</b>
      </div>
      {open && (
        <div className="line">
          <span className="muted">募集剩余</span>
          <b className="mono">{countdown(o.endAt, now)}</b>
        </div>
      )}
      <div>
        <label htmlFor="units" className="muted" style={{ fontSize: ".8rem" }}>认购份数（剩余可认购 {remaining} 份）</label>
        <div className="stepper" style={{ marginTop: 6 }}>
          <button type="button" aria-label="减少一份" onClick={() => set(units - 1)} disabled={units <= 1}>−</button>
          <input id="units" inputMode="numeric" value={units} onChange={(e) => set(Number(e.target.value))} />
          <button type="button" aria-label="增加一份" onClick={() => set(units + 1)} disabled={units >= remaining}>+</button>
        </div>
      </div>
      <div className="line total">
        <span>应付</span>
        <b>{formatUsdt(cost)} USDT</b>
      </div>
      {address && usdt.data && (
        <div className={`approval${needApproval ? "" : " ok"}`}>
          <span className="st" aria-hidden="true" />
          余额 {formatUsdt(usdt.data.balance)} USDT · {needApproval ? "需要先授权 USDT" : "已授权，可直接认购"}
        </div>
      )}
      {needApproval && isConnected && me && (
        <div className="warnbox">
          <b>关于 USDT 授权</b>
          <span>
            授权让平台认购合约可以从你的钱包扣除 USDT。默认不限额，以后认购只需一笔交易；但如果合约出现漏洞，授权额度内的 USDT 都有风险。你可以随时在“我的资产”里撤销。
          </span>
          <div className="radio" role="radiogroup" aria-label="授权额度">
            <label><input type="radio" name="allow" checked={unlimited} onChange={() => setUnlimited(true)} /> 不限额（推荐，之后免授权）</label>
            <label><input type="radio" name="allow" checked={!unlimited} onChange={() => setUnlimited(false)} /> 仅本次 {formatUsdt(cost)} USDT</label>
          </div>
        </div>
      )}
      {referrer && firstPurchase && (
        <p className="muted" style={{ fontSize: ".78rem" }} data-testid="referrer-note">
          邀请人 <span className="mono">{shortAddr(referrer)}</span> 会在你首次认购时绑定。邀请奖励由平台从自己的手续费里支付，不影响你的价格和收益。
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          我已阅读 <Link href="/risk" style={{ color: "var(--amber)" }}>风险披露</Link> 和本项目募集条款，理解份额不是车辆所有权、不保证回报、可能损失全部投资。
        </span>
      </label>
      {!isConnected || !me ? (
        <WalletButton signInLabel="签名登录后认购" />
      ) : (
        <button type="button" className="btn primary" disabled={!!reason || run.running || steps.length === 0} onClick={buy}>
          {run.running ? <span className="spin" aria-hidden="true" /> : null}
          {needApproval ? "授权并认购" : "确认认购"}
        </button>
      )}
      {reason && <p className="muted" style={{ fontSize: ".8rem" }} data-testid="block-reason">{reason}</p>}
      {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
      {done && (
        <p className="okmsg" role="status">
          认购成功，USDT 已进入募集托管。募集结算后份额会发到你的钱包。<Link href="/portfolio">查看我的资产</Link>
        </p>
      )}
      <p className="muted" style={{ fontSize: ".74rem" }}>
        募集截止达到最低 {o.minUnits} 份才会结算发币，否则全额退款。最多 {o.perWalletMax ?? o.maxUnits} 份/钱包。
      </p>
    </aside>
  );
}
