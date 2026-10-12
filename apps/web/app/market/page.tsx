"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, formatDate, formatUsdt, Modal, parseUsdt, shortAddr, StatePill, useAccount, useSession, WalletButton, type ProjectDetail, type ProjectListItem } from "@roboshare/ui";
import { BuyForm, MyListings, SellForm, useMarketTx, type Exec, type UsdtState } from "@/components/MarketPanel";
import { projectCode } from "@/components/ProjectCard";
import { explorer } from "@/env";
import { useI18n } from "@/i18n/I18nProvider";
import { useProject, useProjects } from "@/lib/data";
import { browseListings, premiumPct, useAllListings, useMarketAddress, useMarketTrades, useMarketUsdt, useMarketWallet, type ListingSort, type MarketListing } from "@/lib/market";

type Tab = "buy" | "mine" | "trades";
const TRADABLE = new Set(["FUNDED", "ACTIVE"]);

/** Site-wide peer-to-peer resale market: every project's listings in one place. */
export default function MarketPage() {
  const { t } = useI18n();
  const x = t.p2p;
  const m = t.market;
  const market = useMarketAddress();
  const { address, isConnected } = useAccount();
  const { me } = useSession();
  const signedIn = isConnected && !!me;
  const projects = useProjects();
  const listings = useAllListings();
  const trades = useMarketTrades();
  const usdt = useMarketUsdt(signedIn ? address : undefined);
  const tx = useMarketTx();

  const [tab, setTab] = useState<Tab>("buy");
  const [project, setProject] = useState("");
  const [sort, setSort] = useState<ListingSort>("price");
  const [maxText, setMaxText] = useState("");
  const [buying, setBuying] = useState<MarketListing | null>(null);
  const [selling, setSelling] = useState<string | null>(null);

  // Deep links: /market?project=0x… filters, /market?sell=0x… opens the sell form.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("project");
    const s = q.get("sell");
    if (p && /^0x[0-9a-fA-F]{64}$/.test(p)) setProject(p.toLowerCase());
    if (s && /^0x[0-9a-fA-F]{64}$/.test(s)) setSelling(s.toLowerCase());
    if (q.get("tab") === "mine") setTab("mine");
  }, []);

  const byId = useMemo(() => new Map((projects.data?.items ?? []).map((p) => [p.id.toLowerCase(), p])), [projects.data]);
  const tradable = (projects.data?.items ?? []).filter((p) => TRADABLE.has(p.state));
  const paid = usePaidPerUnit(tradable);
  const stats = new Map((trades.data?.stats ?? []).map((s) => [s.projectId, s]));

  let maxPrice: bigint | undefined;
  try {
    maxPrice = maxText.trim() ? parseUsdt(maxText) : undefined;
  } catch {
    maxPrice = undefined;
  }
  const all = listings.data ?? [];
  const live = browseListings(all, { sort: "price" });
  const shown = browseListings(all, { projectId: project || undefined, maxPrice, sort, exclude: signedIn ? address : undefined });
  const mine = signedIn && address ? all.filter((l) => l.seller.toLowerCase() === address.toLowerCase()) : [];
  const units30d = (trades.data?.stats ?? []).reduce((a, s) => a + s.units30d, 0);
  const label = (pid: string) => {
    const p = byId.get(pid);
    return p ? <Link href={`/projects/${p.id}`}>{p.title ?? projectCode(p)}</Link> : shortAddr(pid);
  };
  const usdtState: UsdtState = { balance: usdt.data?.balance, allowance: usdt.data?.allowance };

  if (!market) {
    return (
      <section>
        <div className="wrap">
          <div className="sec-h"><h1 className="h2">{x.title}</h1></div>
          <div className="panel empty"><p className="muted">{listings.isLoading || projects.isLoading ? m.loading : x.notOpen}</p></div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="wrap">
        <div className="sec-h">
          <div>
            <h1 className="h2">{x.title}</h1>
            <p>{x.intro}</p>
          </div>
          {signedIn ? (
            <button type="button" className="btn primary" onClick={() => setSelling("")}>{x.sellCta}</button>
          ) : (
            <WalletButton signInLabel={m.signIn} />
          )}
        </div>

        <div className="facts mkt-stats">
          <div><span>{x.statListings}</span><b>{live.length}</b></div>
          <div><span>{x.statUnits}</span><b>{t.units.n(live.reduce((a, l) => a + l.fillable, 0))}</b></div>
          <div><span>{x.statLow}</span><b>{live[0] ? `${formatUsdt(live[0].pricePerUnit)} USDT` : "—"}</b></div>
          <div><span>{x.stat30d}</span><b>{t.units.n(units30d)}</b></div>
        </div>

        <div className="filters mkt-tabs" role="tablist" aria-label={x.title}>
          {(["buy", "mine", "trades"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {k === "buy" ? x.tabBuy : k === "mine" ? `${x.tabMine}${mine.length ? ` (${mine.length})` : ""}` : x.tabTrades}
            </button>
          ))}
        </div>

        {tab === "buy" && (
          <>
            <div className="mkt-filter">
              <label className="field">
                <span>{x.filterProject}</span>
                <select value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">{x.filterAll}</option>
                  {tradable.map((p) => <option key={p.id} value={p.id.toLowerCase()}>{p.title ?? projectCode(p)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>{x.maxPrice}</span>
                <input inputMode="decimal" placeholder={x.maxPricePh} value={maxText} onChange={(e) => setMaxText(e.target.value)} />
              </label>
              <label className="field">
                <span>{x.sort}</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as ListingSort)}>
                  <option value="price">{x.sortPrice}</option>
                  <option value="newest">{x.sortNewest}</option>
                </select>
              </label>
            </div>
            {listings.isLoading ? (
              <p className="muted">{m.loading}</p>
            ) : shown.length === 0 ? (
              <div className="panel empty" data-testid="market-empty"><p className="muted">{all.length ? x.empty : x.emptyAll}</p></div>
            ) : (
              <div className="grid">
                {shown.map((l) => (
                  <ListingCard key={l.id.toString()} l={l} p={byId.get(l.projectId)} paid={paid.get(l.projectId)} lastPrice={stats.get(l.projectId)?.lastPrice} signedIn={signedIn} onBuy={() => setBuying(l)} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "mine" && (
          <div className="panel">
            {!signedIn ? (
              <WalletButton signInLabel={m.signIn} />
            ) : mine.length === 0 ? (
              <p className="muted">{x.noMine}</p>
            ) : (
              <MyListingsWithHoldings items={mine} market={market} running={tx.running} exec={tx.exec} label={label} />
            )}
          </div>
        )}

        {tab === "trades" && <Trades label={label} />}

        {!buying && selling === null && tx.progress}
        <p className="fine" style={{ marginTop: 14 }}>{m.fine} {x.refNote}</p>
      </div>

      {buying && (
        <Modal title={x.buyTitle(byId.get(buying.projectId)?.title ?? projectCode({ slug: byId.get(buying.projectId)?.slug ?? null, id: buying.projectId }))} onClose={() => setBuying(null)}>
          <BuyForm l={buying} market={market} usdtState={usdtState} running={tx.running} exec={tx.exec} />
          {tx.progress}
        </Modal>
      )}
      {selling !== null && (
        <Modal title={x.sellCta} onClose={() => setSelling(null)}>
          {signedIn ? <SellPicker initial={selling} tradable={tradable} running={tx.running} exec={tx.exec} lastPrice={(pid) => stats.get(pid)?.lastPrice} /> : <WalletButton signInLabel={m.signIn} />}
          {tx.progress}
        </Modal>
      )}
    </section>
  );
}

/** One listing in the market grid, laid out like a P2P trading offer. */
function ListingCard({ l, p, paid, lastPrice, signedIn, onBuy }: { l: MarketListing; p: ProjectListItem | undefined; paid: bigint | undefined; lastPrice: string | undefined; signedIn: boolean; onBuy: () => void }) {
  const { t } = useI18n();
  const x = t.p2p;
  const ref = p?.offering?.unitPrice;
  const pct = premiumPct(l.pricePerUnit, ref);
  return (
    <div className="pcard mkt-card" data-testid={`market-listing-${l.id}`}>
      <div className="body">
        <div className="t">
          <div>
            <div className="code">{p ? projectCode(p) : shortAddr(l.projectId)}</div>
            <h3>{p ? <Link href={`/projects/${p.id}`}>{p.title ?? projectCode(p)}</Link> : shortAddr(l.projectId)}</h3>
          </div>
          {p && <StatePill state={p.state} />}
        </div>
        <div className="mkt-price">
          <b>{formatUsdt(l.pricePerUnit)}</b> <span>USDT / {x.perUnit}</span>
          {pct !== null && <em className={pct <= 0 ? "down" : "up"}>{x.vsIssue(pct)}</em>}
        </div>
        <div className="kv">
          <div><span>{x.availableLabel}</span><b>{t.units.n(l.fillable)}</b></div>
          <div><span>{x.totalLabel}</span><b>{formatUsdt(l.pricePerUnit * BigInt(l.fillable))}</b></div>
          {paid !== undefined && <div><span>{x.paidLabel}</span><b>{formatUsdt(paid)}</b></div>}
          {lastPrice && <div><span>{x.lastLabel}</span><b>{formatUsdt(lastPrice)}</b></div>}
        </div>
        <div className="line"><span className="muted">{x.seller} {shortAddr(l.seller)}</span><span className="muted">{x.until(formatDate(l.expiresAt * 1000).slice(0, 10))}</span></div>
        {signedIn ? (
          <button type="button" className="btn primary" onClick={onBuy}>{x.buyNow}</button>
        ) : (
          <WalletButton signInLabel={t.market.signIn} />
        )}
      </div>
    </div>
  );
}

/** Gross income paid out so far per unit, by project (sum of claimable batches / units issued). */
function usePaidPerUnit(projects: ProjectListItem[]) {
  const qs = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["distributions", p.id],
      queryFn: () => api.get<{ items: { amount: string }[] }>(`/projects/${p.id}/distributions`),
      staleTime: 60_000,
    })),
  });
  const out = new Map<string, bigint>();
  projects.forEach((p, i) => {
    const items = qs[i]?.data?.items;
    if (!items || p.issuedUnits <= 0) return;
    out.set(p.id.toLowerCase(), items.reduce((a, b) => a + BigInt(b.amount), 0n) / BigInt(p.issuedUnits));
  });
  return out;
}

interface Holding {
  projectId: string;
  units: number;
}

function useHoldings() {
  const { me } = useSession();
  return useQuery({
    queryKey: ["me", "portfolio", me?.wallet],
    enabled: !!me,
    queryFn: () => api.get<{ items: Holding[] }>("/me/portfolio"),
  });
}

function MyListingsWithHoldings({ items, market, running, exec, label }: { items: MarketListing[]; market: `0x${string}`; running: boolean; exec: Exec; label: (pid: string) => ReactNode }) {
  const holdings = useHoldings();
  const held = new Map((holdings.data?.items ?? []).map((h) => [h.projectId.toLowerCase(), h.units]));
  return <MyListings items={items} market={market} held={(pid) => held.get(pid)} running={running} exec={exec} label={label} />;
}

/** "Sell": pick one of my tradable holdings, then the usual sell form. */
function SellPicker({ initial, tradable, running, exec, lastPrice }: { initial: string; tradable: ProjectListItem[]; running: boolean; exec: Exec; lastPrice: (pid: string) => string | undefined }) {
  const { t } = useI18n();
  const x = t.p2p;
  const holdings = useHoldings();
  const ok = new Set(tradable.map((p) => p.id.toLowerCase()));
  const mine = (holdings.data?.items ?? []).filter((h) => h.units > 0 && ok.has(h.projectId.toLowerCase()));
  const [pid, setPid] = useState(initial);
  const chosen = pid || (mine.length === 1 ? mine[0]!.projectId.toLowerCase() : "");

  if (holdings.isLoading) return <p className="muted">{t.market.loading}</p>;
  if (mine.length === 0) return <p className="muted">{x.noHoldings}</p>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {mine.length > 1 && (
        <label className="field">
          <span>{x.pickProject}</span>
          <select value={chosen} onChange={(e) => setPid(e.target.value)}>
            <option value="" disabled>{x.pickProject}</option>
            {mine.map((h) => {
              const p = tradable.find((q) => q.id.toLowerCase() === h.projectId.toLowerCase());
              return <option key={h.projectId} value={h.projectId.toLowerCase()}>{`${p?.title ?? projectCode({ slug: p?.slug ?? null, id: h.projectId })} · ${t.units.n(h.units)}`}</option>;
            })}
          </select>
        </label>
      )}
      {chosen && <SellFor id={chosen} running={running} exec={exec} lastPrice={lastPrice(chosen)} />}
    </div>
  );
}

function SellFor({ id, running, exec, lastPrice }: { id: string; running: boolean; exec: Exec; lastPrice: string | undefined }) {
  const market = useMarketAddress();
  const { address } = useAccount();
  const q = useProject(id);
  const p: ProjectDetail | undefined = q.data;
  const wallet = useMarketWallet(p?.contracts.token ?? null, address);
  if (!market || !p || !wallet.data) return <p className="muted">…</p>;
  return <SellForm p={p} market={market} held={wallet.data.units} unitAllowance={wallet.data.unitAllowance} running={running} exec={exec} lastPrice={lastPrice} />;
}

function Trades({ label }: { label: (pid: string) => ReactNode }) {
  const { t } = useI18n();
  const x = t.p2p;
  const trades = useMarketTrades();
  const items = trades.data?.items ?? [];
  return (
    <div className="panel">
      {items.length === 0 ? (
        <p className="muted">{trades.isLoading ? t.market.loading : x.tradesEmpty}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{x.tabTrades}</caption>
            <thead><tr><th>{x.colTime}</th><th>{x.colProject}</th><th className="r">{x.colUnits}</th><th className="r">{x.colPrice}</th><th className="r">{x.colAmount}</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.chain.txHash + r.listingId}>
                  <td>{explorer ? <a href={`${explorer}/tx/${r.chain.txHash}`} target="_blank" rel="noreferrer">{formatDate(r.at)}</a> : formatDate(r.at)}</td>
                  <td>{label(r.projectId)}</td>
                  <td className="r">{r.units}</td>
                  <td className="r">{formatUsdt(r.pricePerUnit)}</td>
                  <td className="r">{formatUsdt(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
