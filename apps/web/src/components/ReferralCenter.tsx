"use client";
import { useState } from "react";
import type { Hash } from "viem";
import { referralRewardsAbi, REFERRAL_DEFAULT_WINDOW_SECONDS, REFERRAL_LEVEL_BPS } from "@roboshare/shared";
import { api, formatBps, formatUsdt, shortAddr, TxProgress, useAccount, useSession, useTxRunner, WalletButton, type TxStep } from "@roboshare/ui";
import { explorer, isTestChain } from "@/env";
import { useI18n } from "@/i18n/I18nProvider";
import { useRefreshAfterTx } from "@/lib/data";
import { inviteLink, useMyReferrals, useReferralTerms, type MyReferrals, type ReferralMember } from "@/lib/referral";
import { QrCode, qrPng, useQrMatrix } from "./QrCode";

const MONTH = 30 * 24 * 60 * 60;

/** Referral centre: invite link and QR code, referrals on all three levels and referral earnings. */
export function ReferralCenter() {
  const { t } = useI18n();
  const c = t.promo;
  const { isConnected } = useAccount();
  const { me, loading } = useSession();
  const terms = useReferralTerms();
  const enabled = terms.data?.enabled === true;
  const [p1, p2, p3] = REFERRAL_LEVEL_BPS.map((b) => formatBps(b));
  const months = Math.round((terms.data?.windowSeconds ?? REFERRAL_DEFAULT_WINDOW_SECONDS) / MONTH);

  return (
    <section>
      <div className="wrap stack">
        <div className="sec-h">
          <h1 className="h2">{c.title}</h1>
          <p>{c.intro(months)} {c.intro2(p1!, p2!, p3!)}</p>
        </div>
        {!enabled && terms.data && (
          <div className="warnbox" role="note" data-testid="referral-off">{isTestChain ? c.preview : c.closed}</div>
        )}
        {(enabled || isTestChain) &&
          (!isConnected || !me ? (
            <div className="panel empty">
              <p>{loading ? "…" : c.signIn}</p>
              <WalletButton />
            </div>
          ) : (
            <Signed wallet={me.wallet as `0x${string}`} />
          ))}
        <div className="panel">
          <h2 className="h3">{c.rulesTitle}</h2>
          <ul className="rules">
            {c.rules.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Signed({ wallet }: { wallet: `0x${string}` }) {
  const refs = useMyReferrals();
  return (
    <>
      <InviteCard wallet={wallet} referredBy={refs.data?.referredBy?.referrer ?? null} />
      <Earnings wallet={wallet} r={refs.data} />
      <Members r={refs.data} />
    </>
  );
}

function InviteCard({ wallet, referredBy }: { wallet: `0x${string}`; referredBy: string | null }) {
  const { t } = useI18n();
  const c = t.promo;
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "" : inviteLink(window.location.origin, wallet);
  const matrix = useQrMatrix(link);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  async function share() {
    try {
      await navigator.share({ title: "RoboShare", text: c.shareText, url: link });
    } catch {
      // dismissed or not allowed: nothing to do
    }
  }
  function save() {
    const url = qrPng(matrix);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `roboshare-invite-${wallet.slice(2, 8)}.png`;
    a.click();
  }

  return (
    <div className="panel invite">
      <div className="invite-qr">
        <QrCode text={link} label={c.qrAlt} />
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <h2 className="h3">{c.linkTitle}</h2>
        <p className="muted small">{c.linkHint}</p>
        <span className="hash invite-link" data-testid="invite-link">{link}</span>
        <div className="row-actions">
          <button type="button" className="btn primary sm" onClick={copy}>{copied ? c.copied : c.copy}</button>
          {canShare && <button type="button" className="btn ghost sm" onClick={share}>{c.share}</button>}
          <button type="button" className="btn ghost sm" onClick={save}>{c.saveQr}</button>
        </div>
        {referredBy && <p className="muted small">{c.referredBy}<span className="mono">{shortAddr(referredBy)}</span></p>}
      </div>
    </div>
  );
}

function Earnings({ wallet, r }: { wallet: `0x${string}`; r: MyReferrals | undefined }) {
  const { t } = useI18n();
  const c = t.promo;
  const { run, start } = useTxRunner();
  const refresh = useRefreshAfterTx();
  const claimable = r?.claimable ?? null;
  const steps: TxStep[] =
    r?.contract && claimable
      ? [{ label: c.claimStep, write: { address: r.contract, abi: referralRewardsAbi, functionName: "claim", args: [wallet, BigInt(claimable.cumulative), claimable.proof] } }]
      : [];
  async function claim() {
    const ok = await start(steps, (hash: Hash) => void api.post("/tx/pending", { hash, purpose: "REFERRAL_CLAIM" }).catch(() => undefined));
    if (ok) refresh();
  }
  return (
    <div className="panel">
      <h2 className="h3">{c.earningsTitle}</h2>
      <div className="tiles" style={{ marginTop: 10 }}>
        <div className="tile hl"><span className="eyebrow">{c.claimable}</span><span className="num" data-testid="referral-claimable">{formatUsdt(claimable?.amount ?? "0")}</span><small className="muted">USDT</small></div>
        <div className="tile"><span className="eyebrow">{c.earned}</span><span className="num">{formatUsdt(r?.earned ?? "0")}</span><small className="muted">USDT</small></div>
        <div className="tile"><span className="eyebrow">{c.claimed}</span><span className="num">{formatUsdt(r?.claimed ?? "0")}</span><small className="muted">USDT</small></div>
        <div className="tile"><span className="eyebrow">{c.pending}</span><span className="num">{formatUsdt(r?.pendingPublication ?? "0")}</span><small className="muted">USDT</small></div>
      </div>
      {r && BigInt(r.city?.earned ?? "0") > 0n && <p className="muted small" data-testid="referral-city" style={{ marginTop: 8 }}>{c.cityLine(formatUsdt(r.city.earned), r.city.units)}</p>}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary sm" disabled={steps.length === 0 || run.running || run.states[0] === "done"} onClick={claim}>
          {claimable ? c.claim(formatUsdt(claimable.amount)) : c.none}
        </button>
      </div>
      {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
      <h3 className="h4" style={{ marginTop: 16 }}>{c.historyTitle}</h3>
      {(r?.history ?? []).length === 0 ? (
        <p className="muted small">{c.historyEmpty}</p>
      ) : (
        r!.history.map((h) => (
          <div className="tl" key={`${h.projectId}-${h.batchId}-${h.referee}-${h.level}`}>
            <i aria-hidden="true" />
            <span className="mono">{shortAddr(h.referee)} · {h.level === 3 ? c.level3 : h.level === 2 ? c.level2 : c.level1}</span>
            <span>{c.historyRow(h.projectTitle ?? shortAddr(h.projectId), h.batchId, formatUsdt(h.gross), formatUsdt(h.reward))}</span>
          </div>
        ))
      )}
    </div>
  );
}

function Members({ r }: { r: MyReferrals | undefined }) {
  const { t } = useI18n();
  const c = t.promo;
  const list = r?.referees ?? [];
  const second = r?.level2 ?? [];
  const third = r?.level3 ?? [];
  return (
    <div className="panel">
      <h2 className="h3">{c.membersTitle}</h2>
      {list.length === 0 && second.length === 0 && third.length === 0 ? (
        <p className="muted">{c.membersEmpty}</p>
      ) : (
        <>
          <h3 className="h4">{c.level1Title}</h3>
          <p className="muted small" data-testid="members-summary">{c.membersSummary(list.length, list.filter((m) => m.active).length)}</p>
          {list.map((m) => <Member key={m.wallet} m={m} />)}
          <h3 className="h4" style={{ marginTop: 16 }}>{c.level2Title}</h3>
          {second.length === 0 ? (
            <p className="muted small">{c.level2Empty}</p>
          ) : (
            <>
              <p className="muted small" data-testid="level2-summary">{c.membersSummary(second.length, second.filter((m) => m.active).length)}</p>
              {second.map((m) => <Member key={m.wallet} m={m} via={m.via} />)}
            </>
          )}
          <h3 className="h4" style={{ marginTop: 16 }}>{c.level3Title}</h3>
          {third.length === 0 ? (
            <p className="muted small">{c.level3Empty}</p>
          ) : (
            <>
              <p className="muted small" data-testid="level3-summary">{c.membersSummary(third.length, third.filter((m) => m.active).length)}</p>
              {third.map((m) => <Member key={m.wallet} m={m} via={m.via} />)}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Member({ m, via }: { m: ReferralMember; via?: string }) {
  const { t, locale } = useI18n();
  const c = t.promo;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);
  return (
    <div className="hold">
      <span className="ic" aria-hidden="true">👤</span>
      <div>
        <h3 className="h4 mono">{shortAddr(m.wallet)}</h3>
        <small>
          {via && <>{c.via(shortAddr(via))} · </>}
          {m.boundAt ? c.joined(date(m.boundAt)) : c.unknownDate} · {m.active ? c.activeUntil(date(m.expiresAt)) : c.expired(date(m.expiresAt))}
        </small>
      </div>
      <div className="r"><small>{c.memberEarned(formatUsdt(m.earned))}</small></div>
    </div>
  );
}
