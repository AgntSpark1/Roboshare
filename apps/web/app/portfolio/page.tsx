"use client";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { type Hash } from "viem";
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
import { useEligibility, useMySubscriptions, useRefreshAfterTx } from "@/lib/data";
import { EligibilityHelp } from "@/components/Help";
import { ReferralPanel } from "@/components/ReferralPanel";
import { useI18n } from "@/i18n/I18nProvider";

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

export default function Portfolio() {
  const { isConnected } = useAccount();
  const { me, loading } = useSession();
  const { t } = useI18n();
  if (!isConnected || !me) {
    return (
      <section>
        <div className="wrap">
          <div className="sec-h"><h1 className="h2">{t.portfolio.title}</h1></div>
          <div className="panel empty">
            <p>{loading ? t.portfolio.checking : t.portfolio.connectHint}</p>
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
  const { t } = useI18n();
  const c = t.portfolio;
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
          <h1 className="h2">{c.title}</h1>
          <p>
            {c.wallet} <span className="mono">{shortAddr(wallet)}</span> · {c.eligibility}
            {elig.data ? (elig.data.eligibleNow ? <span className="ok-t"> {c.eligible}</span> : <span className="warn-t"> {c.notEligible}</span>) : " —"}
          </p>
        </div>
        {elig.data && !elig.data.eligibleNow && <EligibilityHelp wallet={wallet} />}
        <div className="tiles">
          <div className="tile hl"><span className="eyebrow">{c.claimable}</span><span className="num" data-testid="claimable-total">{formatUsdt(totalClaimable)}</span><small className="muted">USDT</small></div>
          <div className="tile"><span className="eyebrow">{c.claimed}</span><span className="num">{formatUsdt(totalClaimed)}</span><small className="muted">USDT</small></div>
          <div className="tile"><span className="eyebrow">{c.holdings}</span><span className="num">{totalUnits}</span><small className="muted">{c.projectsCount(totalUnits, holdings.data?.items.length ?? 0)}</small></div>
        </div>

        <div className="panel">
          <h2 className="h3">{c.claimableTitle}</h2>
          {claimable.length === 0 ? (
            <p className="muted">{c.noClaimable}</p>
          ) : (
            claimable.map((d) => (
              <ClaimRow key={`${d.projectId}-${d.batchId}`} d={d} name={name(d.projectId)} distributor={project(d.projectId)?.contracts.distributor ?? null} />
            ))
          )}
        </div>

        <div className="cols2">
          <div className="panel">
            <h2 className="h3">{c.holdings}</h2>
            {(holdings.data?.items ?? []).length === 0 ? (
              <p className="muted">{c.noHoldings} <Link href="/projects" style={{ color: "var(--amber)" }}>{c.browse}</Link></p>
            ) : (
              holdings.data!.items.map((h) => (
                <div className="hold" key={h.projectId}>
                  <span className="ic" aria-hidden="true">🚕</span>
                  <div>
                    <h3 className="h4"><Link href={`/projects/${h.projectId}`}>{name(h.projectId)}</Link></h3>
                    <small>{stateLabel(project(h.projectId)?.state ?? "", t.ui.states)} · {c.shareOfIssued(formatBps(h.shareBps))}</small>
                    {["FUNDED", "ACTIVE"].includes(project(h.projectId)?.state ?? "") && (
                      <small> · <Link href={`/projects/${h.projectId}#market`} style={{ color: "var(--amber)" }}>{c.transfer}</Link></small>
                    )}
                  </div>
                  <div className="r"><b className="num">{t.units.n(h.units)}</b><br /><small>{c.cost} {h.costBasis ? formatUsdt(h.costBasis) : "—"}</small></div>
                </div>
              ))
            )}
          </div>
          <div className="panel">
            <h2 className="h3">{c.subsTitle}</h2>
            {(subs.data?.items ?? []).length === 0 ? (
              <p className="muted">{c.noSubs}</p>
            ) : (
              subs.data!.items.map((s) => (
                <SubscriptionRow key={s.projectId} s={s} name={name(s.projectId)} project={project(s.projectId)} />
              ))
            )}
          </div>
        </div>

        <ReferralPanel wallet={wallet} />

        <div className="panel">
          <h2 className="h3">{c.txTitle}</h2>
          {(txs.data?.pending ?? []).map((x) => (
            <div className="tl new" key={x.hash}><i aria-hidden="true" /><span>{c.pendingPurpose[x.purpose] ?? x.purpose} · {c.awaiting}</span><span className="hash">{shortAddr(x.hash, 8, 6)}</span></div>
          ))}
          {(txs.data?.items ?? []).slice(0, 12).map((x, i) => (
            <div className="tl" key={`${x.chain.txHash}-${i}`}>
              <i aria-hidden="true" />
              <span>{c.txKinds[x.kind] ?? x.kind}</span>
              {explorer ? <a className="hash" href={`${explorer}/tx/${x.chain.txHash}`} target="_blank" rel="noreferrer">{shortAddr(x.chain.txHash, 8, 6)}</a> : <span className="hash">{shortAddr(x.chain.txHash, 8, 6)}</span>}
            </div>
          ))}
          {!txs.data?.items.length && !txs.data?.pending.length && <p className="muted">{c.noTx}</p>}
        </div>
      </div>
    </section>
  );
}

function ClaimRow({ d, name, distributor }: { d: MyDistribution; name: string; distributor: `0x${string}` | null }) {
  const { run, start } = useTxRunner();
  const refresh = useRefreshAfterTx();
  const c = useI18n().t.portfolio;
  const steps: TxStep[] = distributor
    ? [{ label: c.claimStep(name, d.batchId), write: { address: distributor, abi: revenueDistributorAbi, functionName: "claim", args: [BigInt(d.batchId)] } }]
    : [];
  async function claim() {
    const ok = await start(steps, (hash: Hash) => void api.post("/tx/pending", { hash, purpose: "CLAIM" }).catch(() => undefined));
    if (ok) refresh();
  }
  const finished = run.states[0] === "done";
  return (
    <div className="claim">
      <div>
        <b>{c.batch(name, d.batchId)}</b>
        <div className="breakdown">
          {c.breakdown(d.units, formatUsdt(d.gross), formatUsdt(d.fee), formatBps(d.feeBps))}<b>{formatUsdt(d.net)} USDT</b>
        </div>
        {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
      </div>
      <button type="button" className="btn primary sm" disabled={!distributor || run.running || finished} onClick={claim}>
        {finished ? c.claimedBtn : c.claimBtn(formatUsdt(d.net))}
      </button>
    </div>
  );
}

function SubscriptionRow({ s, name, project }: { s: { projectId: string; units: number; amount: string; status: string; refundAvailable: boolean }; name: string; project?: ProjectDetail }) {
  const { run, start } = useTxRunner();
  const refresh = useRefreshAfterTx();
  const now = useChainNow();
  const { t } = useI18n();
  const c = t.portfolio;
  const offering = project?.contracts.offering ?? null;
  const o = project?.offering;
  // Anyone may finalize a failed offering after its end; then each subscriber claims their refund.
  const failedButOpen = !!o && o.status === "OPEN" && now >= new Date(o.endAt).getTime() && o.unitsSold < o.minUnits;
  const steps: TxStep[] = !offering
    ? []
    : [
        ...(failedButOpen ? [{ label: c.finalizeFailed, write: { address: offering, abi: offeringManagerAbi, functionName: "finalizeFailed" } }] : []),
        { label: c.claimRefund, write: { address: offering, abi: offeringManagerAbi, functionName: "claimRefund" } },
      ];
  const canRefund = s.status === "REFUNDABLE" || (s.status === "ESCROWED" && failedButOpen);
  return (
    <div className="q">
      <div>
        <h3 className="h4">{name}</h3>
        <small>{t.units.n(s.units)} · {formatUsdt(s.amount)} USDT · {c.status[s.status] ?? s.status}</small>
        {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
      </div>
      {canRefund && (
        <button type="button" className="btn lidar sm" disabled={!offering || run.running} onClick={async () => (await start(steps, (hash: Hash) => void api.post("/tx/pending", { hash, purpose: "REFUND" }).catch(() => undefined))) && refresh()}>
          {c.claimRefund}
        </button>
      )}
    </div>
  );
}
