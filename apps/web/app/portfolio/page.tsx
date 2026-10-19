"use client";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { formatUnits, type Hash } from "viem";
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
  useSwitchChain,
  useTargetChain,
  useTxRunner,
  useUiStrings,
  WalletButton,
  type DailyRevenueItem,
  type ProjectDetail,
  type TxStep,
} from "@roboshare/ui";
import { explorer } from "@/env";
import { useFreezeStatus, useMySubscriptions, useRefreshAfterTx, useUsdtState } from "@/lib/data";
import { holderDaily, pendingTotal, sumByDay, type DailyEarning } from "@/lib/earnings";
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
  capitalReturn?: boolean;
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
  const freeze = useFreezeStatus();
  // Balances are read from this site's chain, so they are right even while the wallet sits on another network.
  const usdt = useUsdtState(wallet as `0x${string}`);
  const { chainId } = useAccount();
  const target = useTargetChain();
  const switcher = useSwitchChain();
  const ui = useUiStrings();
  const wrongChain = chainId !== undefined && chainId !== target.id;
  const chainName = ui.chainNames[target.id] ?? target.name;
  const ids = [...new Set([...(holdings.data?.items ?? []).map((h) => h.projectId), ...(subs.data?.items ?? []).map((s) => s.projectId), ...(dists.data?.items ?? []).map((d) => d.projectId)])];
  const details = useQueries({ queries: ids.map((id) => ({ queryKey: ["project", id], queryFn: () => api.get<ProjectDetail>(`/projects/${id}`) })) });
  const project = (id: string) => details.find((d) => d.data?.id === id)?.data;
  const name = (id: string) => project(id)?.meta?.title ?? shortAddr(id);
  // Two months of days covers everything not yet in a monthly distribution.
  const heldIds = (holdings.data?.items ?? []).map((h) => h.projectId);
  const dailyRows = useQueries({
    queries: heldIds.map((id) => ({
      queryKey: ["daily-revenue", id, 62],
      queryFn: () => api.get<{ items: DailyRevenueItem[] }>(`/projects/${id}/daily-revenue?days=62`),
      retry: false,
    })),
  });
  const dailyOf = new Map<string, DailyEarning[]>();
  (holdings.data?.items ?? []).forEach((h, i) => {
    const items = dailyRows[i]?.data?.items;
    const p = project(h.projectId);
    if (items?.length && p) dailyOf.set(h.projectId, holderDaily(items, h.units, h.issuedUnits, p.feeTiers));
  });
  const myDaily = sumByDay([...dailyOf.values()]);

  const claimable = (dists.data?.items ?? []).filter((d) => !d.claimed);
  const totalClaimable = claimable.reduce((s, d) => s + BigInt(d.net), 0n);
  const totalClaimed = (dists.data?.items ?? []).filter((d) => d.claimed).reduce((s, d) => s + BigInt(d.net), 0n);
  const totalUnits = (holdings.data?.items ?? []).reduce((s, h) => s + h.units, 0);
  // Escrowed subscriptions become units only when the offering settles; show them as pending meanwhile.
  const pendingUnits = (subs.data?.items ?? []).filter((s) => s.status === "ESCROWED").reduce((n, s) => n + s.units, 0);

  return (
    <section>
      <div className="wrap stack">
        <div className="sec-h">
          <h1 className="h2">{c.title}</h1>
          <p>
            {c.wallet} <span className="mono">{shortAddr(wallet)}</span>
            {/* There is no KYC; the only status worth showing is a freeze. */}
            {freeze.data?.frozen && <span className="warn-t">{" · "}{t.subscribe.block.frozen}</span>}
          </p>
        </div>
        {wrongChain && (
          <div className="helpbox" role="alert" data-testid="wrong-chain">
            <p>{c.wrongChain(chainName)}</p>
            <button type="button" className="btn ghost sm" disabled={switcher.pending} onClick={() => void switcher.switchChain()}>
              {ui.switchTo(chainName)}
            </button>
          </div>
        )}
        <div className="tiles four">
          <div className="tile">
            <span className="eyebrow">{c.walletBalance}</span>
            <span className="num" data-testid="wallet-usdt">{usdt.data ? formatUsdt(usdt.data.balance) : "—"}</span>
            <small className="muted">USDT{usdt.data && ` · ${c.gasBalance(Number(formatUnits(usdt.data.native, 18)).toFixed(4))}`}</small>
          </div>
          <div className="tile hl"><span className="eyebrow">{c.claimable}</span><span className="num" data-testid="claimable-total">{formatUsdt(totalClaimable)}</span><small className="muted">USDT</small></div>
          <div className="tile"><span className="eyebrow">{c.claimed}</span><span className="num">{formatUsdt(totalClaimed)}</span><small className="muted">USDT</small></div>
          <div className="tile"><span className="eyebrow">{c.holdings}</span><span className="num">{totalUnits}</span><small className="muted">{c.projectsCount(totalUnits, holdings.data?.items.length ?? 0)}{pendingUnits > 0 && ` · ${c.pendingUnits(pendingUnits)}`}</small></div>
        </div>

        {totalUnits > 0 && <DailyEarnings days={myDaily} />}

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
              pendingUnits > 0 ? (
                <p className="muted" data-testid="pending-units">{c.pendingNote(pendingUnits)}</p>
              ) : (
                <p className="muted">{c.noHoldings} <Link href="/projects" style={{ color: "var(--amber)" }}>{c.browse}</Link></p>
              )
            ) : (
              holdings.data!.items.map((h) => (
                <div className="hold" key={h.projectId}>
                  <span className="ic" aria-hidden="true">🚕</span>
                  <div>
                    <h3 className="h4"><Link href={`/projects/${h.projectId}`}>{name(h.projectId)}</Link></h3>
                    <small>{stateLabel(project(h.projectId)?.state ?? "", t.ui.states)} · {c.shareOfIssued(formatBps(h.shareBps))}</small>
                    {dailyOf.get(h.projectId)?.[0] && (
                      <small style={{ display: "block", color: "var(--amber)" }} data-testid="holding-daily">{c.daily.holdingLine(dailyOf.get(h.projectId)![0]!.day, formatUsdt(dailyOf.get(h.projectId)![0]!.amount))}</small>
                    )}
                    {["FUNDED", "ACTIVE"].includes(project(h.projectId)?.state ?? "") && (
                      <small> · <Link href={`/market?sell=${h.projectId}`} style={{ color: "var(--amber)" }}>{c.transfer}</Link></small>
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

function DailyEarnings({ days }: { days: DailyEarning[] }) {
  const { t } = useI18n();
  const c = t.portfolio.daily;
  const pendingTag = <span className="tag-s warn-t">{t.project.daily.pending}</span>;
  const latest = days[0];
  return (
    <div className="panel" data-testid="daily-earnings">
      <h2 className="h3">{c.title}</h2>
      {!latest ? (
        <p className="muted">{c.none}</p>
      ) : (
        <>
          <div className="daily-today">
            <span className="muted">{c.latest(latest.day)}</span>
            <b className="num" data-testid="daily-latest">{formatUsdt(latest.amount)} USDT</b>
            {latest.pending && pendingTag}
          </div>
          <p className="muted">{c.pendingTotal(formatUsdt(pendingTotal(days)))}</p>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">{t.project.daily.recent}</caption>
              <thead><tr><th>{t.project.daily.date}</th><th className="r">{c.income}</th></tr></thead>
              <tbody>
                {days.slice(0, 7).map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}{d.pending && pendingTag}</td>
                    <td className="r">{formatUsdt(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ClaimRow({ d, name, distributor }: { d: MyDistribution; name: string; distributor: `0x${string}` | null }) {
  const { run, start } = useTxRunner();
  const refresh = useRefreshAfterTx();
  const { t } = useI18n();
  const c = t.portfolio;
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
        {d.capitalReturn && <span className="tag-s ok-t" data-testid="capital-return">{t.project.capitalReturn}</span>}
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
