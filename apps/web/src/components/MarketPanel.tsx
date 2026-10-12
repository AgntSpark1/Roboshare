"use client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { erc20Abi, maxUint256, type Address, type Hash } from "viem";
import { shareMarketAbi } from "@roboshare/shared";
import {
  api,
  formatDate,
  formatUsdt,
  parseUsdt,
  TxProgress,
  useAccount,
  useSession,
  useTxRunner,
  WalletButton,
  type ProjectDetail,
  type TxStep,
} from "@roboshare/ui";
import { explorer } from "@/env";
import { useEligibility, usePaymentSetup, useRefreshAfterTx } from "@/lib/data";
import { browseListings, useListings, useMarketAddress, useMarketTrades, useMarketWallet, type MarketListing } from "@/lib/market";
import { useI18n } from "@/i18n/I18nProvider";
import { zhCN, type Messages } from "@/i18n/messages/zh-CN";

type Purpose = "APPROVE" | "MARKET_LIST" | "MARKET_BUY" | "MARKET_CANCEL";
export type MarketStep = TxStep & { purpose: Purpose };
export type Exec = (s: MarketStep[], message: string) => Promise<boolean>;
export type UsdtState = { balance: bigint | undefined; allowance: bigint | undefined };

const DAY = 86_400;
export const DURATIONS = [7, 30, 90] as const;
type Duration = (typeof DURATIONS)[number];

/** Why the buy button is disabled. Exported for tests. */
export function buyBlockReason(input: {
  eligible: boolean | undefined;
  available: number;
  units: number;
  balance: bigint | undefined;
  cost: bigint;
  acknowledged: boolean;
}, t: Messages = zhCN): string | null {
  const b = t.subscribe.block;
  if (input.eligible === false) return b.ineligible;
  if (input.units < 1 || input.units > input.available) return t.market.buyRange(input.available);
  if (input.balance !== undefined && input.balance < input.cost) return b.balance;
  if (!input.acknowledged) return b.ack;
  return null;
}

/** Parses the seller's form. Exported for tests. */
export function sellInput(held: number, units: number, priceText: string, m: Messages["market"] = zhCN.market): { price: bigint } | { error: string } {
  if (held <= 0) return { error: m.noUnits };
  if (units < 1 || units > held) return { error: m.sellRange(held) };
  let price: bigint;
  try {
    price = parseUsdt(priceText);
  } catch {
    return { error: m.price };
  }
  if (price <= 0n) return { error: m.price };
  return { price };
}

/** A listing's state from the seller's side. Exported for tests. */
export function listingStatus(l: MarketListing, nowSec = Math.floor(Date.now() / 1000)): "live" | "expired" | "short" {
  if (l.expiresAt <= nowSec) return "expired";
  return l.fillable < l.units ? "short" : "live";
}

const expiryIn = (days: Duration) => BigInt(Math.floor(Date.now() / 1000) + days * DAY);

/** Runs market transactions with one progress display; API views refresh afterwards. */
export function useMarketTx(): { exec: Exec; running: boolean; progress: ReactNode } {
  const { run, start, reset } = useTxRunner();
  const [steps, setSteps] = useState<MarketStep[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const refresh = useRefreshAfterTx();

  async function exec(s: MarketStep[], message: string) {
    reset();
    setDone(null);
    setSteps(s);
    const ok = await start(s, (hash: Hash, i: number) => {
      // Approvals are not indexed, so they would stay "pending" forever.
      if (s[i]!.purpose !== "APPROVE") void api.post("/tx/pending", { hash, purpose: s[i]!.purpose }).catch(() => undefined);
    });
    if (ok) {
      setDone(message);
      refresh();
    }
    return ok;
  }

  const progress = (
    <>
      {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
      {done && <p className="okmsg" role="status">{done}</p>}
    </>
  );
  return { exec, running: run.running, progress };
}

/** Peer-to-peer resale for one project (EARLY_EXIT_DESIGN.md), linking to the site-wide market. */
export function MarketPanel({ p }: { p: ProjectDetail }) {
  const market = useMarketAddress();
  const { t } = useI18n();
  const m = t.market;
  const x = t.p2p;
  const { address, isConnected } = useAccount();
  const { me } = useSession();
  const listings = useListings(p.id);
  const trades = useMarketTrades(p.id);
  const wallet = useMarketWallet(p.contracts.token, address);
  const usdt: UsdtState = { balance: wallet.data?.usdtBalance, allowance: wallet.data?.usdtAllowance };
  const tx = useMarketTx();

  if (!market || !p.contracts.token) return null;

  const all = listings.data ?? [];
  const mine = (l: MarketListing) => !!address && l.seller.toLowerCase() === address.toLowerCase();
  const forSale = browseListings(all, { sort: "price", exclude: address });
  const myListings = all.filter(mine);
  const low = browseListings(all, { sort: "price" })[0];
  const last = trades.data?.stats[0];
  const signedIn = isConnected && !!me;

  return (
    <div className="panel" id="market" style={{ marginTop: 24 }}>
      <h2 className="h3">
        {m.title}
        <Link className="btn ghost sm" href={`/market?project=${p.id}`}>{x.viewAll}</Link>
      </h2>
      <p className="muted" style={{ fontSize: ".84rem" }}>{m.intro}</p>
      <div className="mkt-ref">
        {p.offering && <span>{x.issuePrice(formatUsdt(p.offering.unitPrice))}</span>}
        {low && <span>{x.lowest(formatUsdt(low.pricePerUnit))}</span>}
        {last && <span>{x.lastTrade(formatUsdt(last.lastPrice))}</span>}
      </div>

      {forSale.length ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{m.forSale}</caption>
            <thead><tr><th>{m.colForSale}</th><th className="r">{m.colPrice}</th><th>{m.colExpires}</th><th><span className="sr-only">{m.actions}</span></th></tr></thead>
            <tbody>
              {forSale.map((l) => (
                <ListingRow key={l.id.toString()} l={l} market={market} signedIn={signedIn} usdtState={usdt} running={tx.running} exec={tx.exec} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" data-testid="no-listings">{listings.isLoading ? m.loading : m.none}</p>
      )}

      {!signedIn ? (
        <div style={{ marginTop: 12 }}><WalletButton signInLabel={m.signIn} /></div>
      ) : (
        <>
          {myListings.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 className="h3" style={{ fontSize: ".95rem" }}>{m.myListings}</h3>
              <MyListings items={myListings} market={market} held={() => wallet.data?.units} running={tx.running} exec={tx.exec} />
            </div>
          )}
          {(wallet.data?.units ?? 0) > 0 && (
            <SellForm p={p} market={market} held={wallet.data!.units} unitAllowance={wallet.data!.unitAllowance} running={tx.running} exec={tx.exec} lastPrice={last?.lastPrice} />
          )}
        </>
      )}

      {tx.progress}
      <p className="fine" style={{ marginTop: 10 }}>{m.fine}</p>
    </div>
  );
}

function ListingRow({ l, market, signedIn, usdtState, running, exec }: { l: MarketListing; market: Address; signedIn: boolean; usdtState: UsdtState; running: boolean; exec: Exec }) {
  const [openBuy, setOpenBuy] = useState(false);
  const { t } = useI18n();
  return (
    <>
      <tr data-testid={`listing-${l.id}`}>
        <td>{t.units.n(l.fillable)}</td>
        <td className="r">{formatUsdt(l.pricePerUnit)}</td>
        <td>{formatDate(l.expiresAt * 1000).slice(0, 10)}</td>
        <td className="r">
          {signedIn && (
            <button type="button" className="btn ghost sm" aria-expanded={openBuy} onClick={() => setOpenBuy(!openBuy)}>
              {t.market.buy}
            </button>
          )}
        </td>
      </tr>
      {openBuy && (
        <tr>
          <td colSpan={4}>
            <BuyForm l={l} market={market} usdtState={usdtState} running={running} exec={exec} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Buys units from one listing. USDT is approved once without a limit, as in the subscribe flow. */
export function BuyForm({ l, market, usdtState, running, exec, onDone }: { l: MarketListing; market: Address; usdtState: UsdtState; running: boolean; exec: Exec; onDone?: () => void }) {
  const elig = useEligibility();
  const { t } = useI18n();
  const m = t.market;
  const c = t.subscribe;
  const { usdt } = usePaymentSetup();
  const [units, setUnits] = useState(1);
  const [ack, setAck] = useState(false);
  const cost = l.pricePerUnit * BigInt(units);
  const needApproval = usdtState.allowance === undefined ? true : usdtState.allowance < cost;
  const reason = buyBlockReason({ eligible: elig.data?.eligibleNow, available: l.fillable, units, balance: usdtState.balance, cost, acknowledged: ack }, t);

  const steps = useMemo<MarketStep[]>(() => {
    if (!usdt) return [];
    const s: MarketStep[] = [];
    if (needApproval) {
      s.push({ label: c.stepApproveUnlimited, purpose: "APPROVE", write: { address: usdt, abi: erc20Abi, functionName: "approve", args: [market, maxUint256] } });
    }
    s.push({
      label: m.stepBuy(units),
      purpose: "MARKET_BUY",
      write: { address: market, abi: shareMarketAbi, functionName: "buy", args: [l.id, units, l.pricePerUnit] },
    });
    return s;
  }, [usdt, needApproval, market, l.id, l.pricePerUnit, units, c, m]);

  const set = (n: number) => setUnits(Math.max(1, Math.min(Math.max(l.fillable, 1), Math.floor(n) || 1)));

  return (
    <div style={{ display: "grid", gap: 10, padding: "8px 0" }}>
      <label htmlFor={`buy-units-${l.id}`} className="muted" style={{ fontSize: ".8rem" }}>{m.buyUnits}</label>
      <div className="stepper">
        <button type="button" aria-label={c.less} onClick={() => set(units - 1)} disabled={units <= 1}>−</button>
        <input id={`buy-units-${l.id}`} inputMode="numeric" value={units} onChange={(e) => set(Number(e.target.value))} />
        <button type="button" aria-label={c.more} onClick={() => set(units + 1)} disabled={units >= l.fillable}>+</button>
      </div>
      {l.fillable > 1 && (
        <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => set(l.fillable)}>
          {t.p2p.buyAll(l.fillable)}
        </button>
      )}
      <div className="line"><span className="muted">{t.p2p.perUnit}</span><b>{formatUsdt(l.pricePerUnit)} USDT</b></div>
      <div className="line total"><span>{c.due}</span><b>{formatUsdt(cost)} USDT</b></div>
      <label className="check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>{c.ackBefore}<Link href="/risk" style={{ color: "var(--amber)" }}>{t.layout.investorNotes}</Link>{c.ackAfter}</span>
      </label>
      <button
        type="button"
        className="btn primary"
        disabled={!!reason || running || steps.length === 0}
        onClick={async () => {
          if (await exec(steps, m.bought(units))) onDone?.();
        }}
      >
        {needApproval ? m.approveAndBuy : m.confirmBuy}
      </button>
      {reason && <p className="muted" style={{ fontSize: ".8rem" }}>{reason}</p>}
    </div>
  );
}

/** Lists units of one project for sale. */
export function SellForm({
  p,
  market,
  held,
  unitAllowance,
  running,
  exec,
  lastPrice,
  onDone,
}: {
  p: ProjectDetail;
  market: Address;
  held: number;
  unitAllowance: bigint;
  running: boolean;
  exec: Exec;
  lastPrice?: string;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const m = t.market;
  const [units, setUnits] = useState(1);
  const [priceText, setPriceText] = useState("");
  const [days, setDays] = useState<Duration>(30);
  const parsed = sellInput(held, units, priceText, m);

  async function list() {
    if ("error" in parsed) return;
    const s: MarketStep[] = [];
    // One approval covers every unit held, so later listings need no extra step.
    if (unitAllowance < BigInt(held)) {
      s.push({ label: m.approveUnits, purpose: "APPROVE", write: { address: p.contracts.token!, abi: erc20Abi, functionName: "approve", args: [market, maxUint256] } });
    }
    s.push({ label: m.stepList(units), purpose: "MARKET_LIST", write: { address: market, abi: shareMarketAbi, functionName: "list", args: [p.id, units, parsed.price, expiryIn(days)] } });
    if (await exec(s, m.listed)) onDone?.();
  }

  return (
    <div className="form" style={{ marginTop: 16 }}>
      <h3 className="h3" style={{ fontSize: ".95rem" }}>{m.sellTitle(held)}</h3>
      <div className="row">
        <label className="field">
          <span>{m.sellUnits}</span>
          <input inputMode="numeric" value={units} onChange={(e) => setUnits(Math.floor(Number(e.target.value)) || 0)} />
        </label>
        <label className="field">
          <span>{m.sellPrice}</span>
          <input inputMode="decimal" placeholder={m.pricePlaceholder} value={priceText} onChange={(e) => setPriceText(e.target.value)} />
        </label>
        <label className="field">
          <span>{m.duration}</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value) as Duration)}>
            {DURATIONS.map((d) => <option key={d} value={d}>{m.days(d)}</option>)}
          </select>
        </label>
      </div>
      <div className="mkt-ref">
        {p.offering && <span>{t.p2p.issuePrice(formatUsdt(p.offering.unitPrice))}</span>}
        {lastPrice && <span>{t.p2p.lastTrade(formatUsdt(lastPrice))}</span>}
      </div>
      {"price" in parsed && <p className="muted" style={{ fontSize: ".84rem" }}>{m.proceeds(formatUsdt(parsed.price * BigInt(units)))}</p>}
      <button type="button" className="btn primary" style={{ marginTop: 8 }} disabled={"error" in parsed || running} onClick={list}>
        {m.listBtn}
      </button>
      {"error" in parsed && priceText !== "" && <p className="muted" style={{ fontSize: ".8rem" }}>{parsed.error}</p>}
    </div>
  );
}

/** The seller's own listings: status, change price/units/validity, or cancel. */
export function MyListings({
  items,
  market,
  held,
  running,
  exec,
  label,
}: {
  items: MarketListing[];
  market: Address;
  /** Units the seller holds in a project, when known; caps the edit form. */
  held: (projectId: string) => number | undefined;
  running: boolean;
  exec: Exec;
  /** Adds a project column (site-wide market). */
  label?: (projectId: string) => ReactNode;
}) {
  const { t } = useI18n();
  const m = t.market;
  const x = t.p2p;
  const [editing, setEditing] = useState<bigint | null>(null);
  const cols = label ? 5 : 4;
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">{m.myListings}</caption>
        <thead>
          <tr>
            {label && <th>{x.colProject}</th>}
            <th>{m.colRemaining}</th>
            <th className="r">{m.colPrice}</th>
            <th>{m.colExpires}</th>
            <th><span className="sr-only">{m.actions}</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => {
            const status = listingStatus(l);
            const open = editing === l.id;
            return (
              <MyListingRow key={l.id.toString()} l={l} cols={cols} label={label} status={status} open={open} toggle={() => setEditing(open ? null : l.id)} market={market} held={held(l.projectId)} running={running} exec={exec} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MyListingRow({
  l,
  cols,
  label,
  status,
  open,
  toggle,
  market,
  held,
  running,
  exec,
}: {
  l: MarketListing;
  cols: number;
  label?: (projectId: string) => ReactNode;
  status: "live" | "expired" | "short";
  open: boolean;
  toggle: () => void;
  market: Address;
  held: number | undefined;
  running: boolean;
  exec: Exec;
}) {
  const { t } = useI18n();
  const m = t.market;
  const x = t.p2p;
  return (
    <>
      <tr data-testid={`my-listing-${l.id}`}>
        {label && <td>{label(l.projectId)}</td>}
        <td>{t.units.n(l.units)} <span className={`mkt-st ${status}`}>{x.status[status]}</span></td>
        <td className="r">{formatUsdt(l.pricePerUnit)}</td>
        <td>{formatDate(l.expiresAt * 1000).slice(0, 10)}</td>
        <td className="r" style={{ whiteSpace: "nowrap" }}>
          <button type="button" className="btn ghost sm" aria-expanded={open} disabled={running} onClick={toggle}>
            {x.edit}
          </button>{" "}
          <button
            type="button"
            className="btn ghost sm"
            disabled={running}
            onClick={() =>
              exec([{ label: m.cancelStep, purpose: "MARKET_CANCEL", write: { address: market, abi: shareMarketAbi, functionName: "cancel", args: [l.id] } }], m.cancelled)
            }
          >
            {m.cancel}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={cols}>
            <EditListing l={l} market={market} held={held} running={running} exec={exec} onDone={toggle} />
          </td>
        </tr>
      )}
    </>
  );
}

function EditListing({ l, market, held, running, exec, onDone }: { l: MarketListing; market: Address; held: number | undefined; running: boolean; exec: Exec; onDone: () => void }) {
  const { t } = useI18n();
  const m = t.market;
  const x = t.p2p;
  const [units, setUnits] = useState(Math.min(l.units, held ?? l.units) || l.units);
  const [priceText, setPriceText] = useState(formatUsdt(l.pricePerUnit).replace(/,/g, ""));
  const [days, setDays] = useState<Duration>(30);
  const parsed = sellInput(held ?? l.units, units, priceText, m);

  async function save() {
    if ("error" in parsed) return;
    const ok = await exec(
      [{ label: x.saveStep, purpose: "MARKET_LIST", write: { address: market, abi: shareMarketAbi, functionName: "updateListing", args: [l.id, units, parsed.price, expiryIn(days)] } }],
      x.saved,
    );
    if (ok) onDone();
  }

  return (
    <div className="form" style={{ padding: "8px 0" }}>
      <div className="row">
        <label className="field">
          <span>{m.sellUnits}</span>
          <input inputMode="numeric" value={units} onChange={(e) => setUnits(Math.floor(Number(e.target.value)) || 0)} />
        </label>
        <label className="field">
          <span>{m.sellPrice}</span>
          <input inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
        </label>
        <label className="field">
          <span>{x.renew}</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value) as Duration)}>
            {DURATIONS.map((d) => <option key={d} value={d}>{m.days(d)}</option>)}
          </select>
        </label>
      </div>
      <button type="button" className="btn primary sm" style={{ marginTop: 8 }} disabled={"error" in parsed || running} onClick={save}>
        {x.save}
      </button>
      {"error" in parsed && <p className="muted" style={{ fontSize: ".8rem" }}>{parsed.error}</p>}
    </div>
  );
}
