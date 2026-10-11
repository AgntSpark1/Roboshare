"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
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
import { activeListings, useListings, useMarketAddress, useMarketWallet, type MarketListing } from "@/lib/market";
import { useI18n } from "@/i18n/I18nProvider";
import { zhCN, type Messages } from "@/i18n/messages/zh-CN";

type Purpose = "APPROVE" | "MARKET_LIST" | "MARKET_BUY" | "MARKET_CANCEL";
type Step = TxStep & { purpose: Purpose };
type UsdtState = { balance: bigint | undefined; allowance: bigint | undefined };

const DAY = 86_400;
const DURATIONS = [7, 30, 90] as const;

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

/** Peer-to-peer resale (EARLY_EXIT_DESIGN.md): buy listed units, or list your own for sale. */
export function MarketPanel({ p }: { p: ProjectDetail }) {
  const market = useMarketAddress();
  const { t } = useI18n();
  const m = t.market;
  const { address, isConnected } = useAccount();
  const { me } = useSession();
  const listings = useListings(p.id);
  const wallet = useMarketWallet(p.contracts.token, address);
  const { run, start, reset } = useTxRunner();
  const [steps, setSteps] = useState<Step[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const refresh = useRefreshAfterTx();

  if (!market || !p.contracts.token) return null;

  const mine = (l: MarketListing) => !!address && l.seller.toLowerCase() === address.toLowerCase();
  const open = activeListings(listings.data ?? []);
  const forSale = open.filter((l) => !mine(l));
  const myListings = (listings.data ?? []).filter((l) => mine(l) && l.units > 0);

  async function exec(s: Step[], message: string) {
    reset();
    setDone(null);
    setSteps(s);
    const ok = await start(s, (hash: Hash, i: number) => {
      // Approvals are not indexed, so they would stay "pending" forever.
      if (s[i]!.purpose !== "APPROVE") void api.post("/tx/pending", { hash, purpose: s[i]!.purpose }).catch(() => undefined);
    });
    if (ok) {
      setDone(message);
      void listings.refetch();
      void wallet.refetch();
      refresh();
    }
  }

  const signedIn = isConnected && !!me;
  const usdtState: UsdtState = { balance: wallet.data?.usdtBalance, allowance: wallet.data?.usdtAllowance };

  return (
    <div className="panel" id="market" style={{ marginTop: 24 }}>
      <h2 className="h3">{m.title}</h2>
      <p className="muted" style={{ fontSize: ".84rem" }}>{m.intro}</p>

      {forSale.length ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{m.forSale}</caption>
            <thead><tr><th>{m.colForSale}</th><th className="r">{m.colPrice}</th><th>{m.colExpires}</th><th><span className="sr-only">{m.actions}</span></th></tr></thead>
            <tbody>
              {forSale.map((l) => (
                <ListingRow key={l.id.toString()} l={l} market={market} signedIn={signedIn} usdtState={usdtState} running={run.running} exec={exec} />
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
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">{m.myListings}</caption>
                  <thead><tr><th>{m.colRemaining}</th><th className="r">{m.colPrice}</th><th>{m.colExpires}</th><th><span className="sr-only">{m.actions}</span></th></tr></thead>
                  <tbody>
                    {myListings.map((l) => (
                      <tr key={l.id.toString()} data-testid={`my-listing-${l.id}`}>
                        <td>{t.units.n(l.units)}</td>
                        <td className="r">{formatUsdt(l.pricePerUnit)}</td>
                        <td>{formatDate(l.expiresAt * 1000).slice(0, 10)}</td>
                        <td className="r">
                          <button
                            type="button"
                            className="btn ghost sm"
                            disabled={run.running}
                            onClick={() =>
                              exec(
                                [{ label: m.cancelStep, purpose: "MARKET_CANCEL", write: { address: market, abi: shareMarketAbi, functionName: "cancel", args: [l.id] } }],
                                m.cancelled,
                              )
                            }
                          >
                            {m.cancel}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {(wallet.data?.units ?? 0) > 0 && (
            <SellForm p={p} market={market} held={wallet.data!.units} unitAllowance={wallet.data!.unitAllowance} running={run.running} exec={exec} />
          )}
        </>
      )}

      {run.states.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
      {done && <p className="okmsg" role="status">{done}</p>}
      <p className="fine" style={{ marginTop: 10 }}>{m.fine}</p>
    </div>
  );
}

function ListingRow({
  l,
  market,
  signedIn,
  usdtState,
  running,
  exec,
}: {
  l: MarketListing;
  market: Address;
  signedIn: boolean;
  usdtState: UsdtState;
  running: boolean;
  exec: (s: Step[], message: string) => Promise<void>;
}) {
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

function BuyForm({ l, market, usdtState, running, exec }: { l: MarketListing; market: Address; usdtState: UsdtState; running: boolean; exec: (s: Step[], message: string) => Promise<void> }) {
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

  const steps = useMemo<Step[]>(() => {
    if (!usdt) return [];
    const s: Step[] = [];
    if (needApproval) {
      s.push({ label: c.stepApprove(formatUsdt(cost)), purpose: "APPROVE", write: { address: usdt, abi: erc20Abi, functionName: "approve", args: [market, cost] } });
    }
    s.push({
      label: m.stepBuy(units),
      purpose: "MARKET_BUY",
      write: { address: market, abi: shareMarketAbi, functionName: "buy", args: [l.id, units, l.pricePerUnit] },
    });
    return s;
  }, [usdt, needApproval, cost, market, l.id, l.pricePerUnit, units, c, m]);

  const set = (n: number) => setUnits(Math.max(1, Math.min(Math.max(l.fillable, 1), Math.floor(n) || 1)));

  return (
    <div style={{ display: "grid", gap: 10, padding: "8px 0" }}>
      <label htmlFor={`buy-units-${l.id}`} className="muted" style={{ fontSize: ".8rem" }}>{m.buyUnits}</label>
      <div className="stepper">
        <button type="button" aria-label={c.less} onClick={() => set(units - 1)} disabled={units <= 1}>−</button>
        <input id={`buy-units-${l.id}`} inputMode="numeric" value={units} onChange={(e) => set(Number(e.target.value))} />
        <button type="button" aria-label={c.more} onClick={() => set(units + 1)} disabled={units >= l.fillable}>+</button>
      </div>
      <div className="line total"><span>{c.due}</span><b>{formatUsdt(cost)} USDT</b></div>
      <label className="check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>{c.ackBefore}<Link href="/risk" style={{ color: "var(--amber)" }}>{t.layout.investorNotes}</Link>{c.ackAfter}</span>
      </label>
      <button type="button" className="btn primary" disabled={!!reason || running || steps.length === 0} onClick={() => exec(steps, m.bought(units))}>
        {needApproval ? m.approveAndBuy : m.confirmBuy}
      </button>
      {reason && <p className="muted" style={{ fontSize: ".8rem" }}>{reason}</p>}
    </div>
  );
}

function SellForm({
  p,
  market,
  held,
  unitAllowance,
  running,
  exec,
}: {
  p: ProjectDetail;
  market: Address;
  held: number;
  unitAllowance: bigint;
  running: boolean;
  exec: (s: Step[], message: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const m = t.market;
  const [units, setUnits] = useState(1);
  const [priceText, setPriceText] = useState("");
  const [days, setDays] = useState<(typeof DURATIONS)[number]>(30);
  const parsed = sellInput(held, units, priceText, m);

  function list() {
    if ("error" in parsed) return;
    const s: Step[] = [];
    // One approval covers every unit held, so later listings need no extra step.
    if (unitAllowance < BigInt(held)) {
      s.push({ label: m.approveUnits, purpose: "APPROVE", write: { address: p.contracts.token!, abi: erc20Abi, functionName: "approve", args: [market, maxUint256] } });
    }
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + days * DAY);
    s.push({ label: m.stepList(units), purpose: "MARKET_LIST", write: { address: market, abi: shareMarketAbi, functionName: "list", args: [p.id, units, parsed.price, expiresAt] } });
    void exec(s, m.listed);
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
          <select value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof DURATIONS)[number])}>
            {DURATIONS.map((d) => <option key={d} value={d}>{m.days(d)}</option>)}
          </select>
        </label>
      </div>
      {p.offering && <p className="muted" style={{ fontSize: ".8rem" }}>{m.refPrice(formatUsdt(p.offering.unitPrice))}</p>}
      {"price" in parsed && <p className="muted" style={{ fontSize: ".84rem" }}>{m.proceeds(formatUsdt(parsed.price * BigInt(units)))}</p>}
      <button type="button" className="btn primary" style={{ marginTop: 8 }} disabled={"error" in parsed || running} onClick={list}>
        {m.listBtn}
      </button>
      {"error" in parsed && priceText !== "" && <p className="muted" style={{ fontSize: ".8rem" }}>{parsed.error}</p>}
    </div>
  );
}
