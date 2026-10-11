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
}): string | null {
  if (input.eligible === false) return "你的钱包还未开通认购资格";
  if (input.units < 1 || input.units > input.available) return `可买 1–${input.available} 份`;
  if (input.balance !== undefined && input.balance < input.cost) return "USDT 余额不足";
  if (!input.acknowledged) return "请先勾选确认";
  return null;
}

/** Parses the seller's form. Exported for tests. */
export function sellInput(held: number, units: number, priceText: string): { price: bigint } | { error: string } {
  if (held <= 0) return { error: "你没有可出售的份额" };
  if (units < 1 || units > held) return { error: `可卖 1–${held} 份` };
  let price: bigint;
  try {
    price = parseUsdt(priceText);
  } catch {
    return { error: "请输入每份价格" };
  }
  if (price <= 0n) return { error: "请输入每份价格" };
  return { price };
}

/** Peer-to-peer resale (EARLY_EXIT_DESIGN.md): buy listed units, or list your own for sale. */
export function MarketPanel({ p }: { p: ProjectDetail }) {
  const market = useMarketAddress();
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
      void api.post("/tx/pending", { hash, purpose: s[i]!.purpose }).catch(() => undefined);
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
      <h2 className="h3">转让市场</h2>
      <p className="muted" style={{ fontSize: ".84rem" }}>想提前拿回资金，可以挂单把份额卖给其他投资者；也可以在这里买入别人转让的份额。</p>

      {forSale.length ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">在售份额</caption>
            <thead><tr><th>在售</th><th className="r">每份价格（USDT）</th><th>截止</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {forSale.map((l) => (
                <ListingRow key={l.id.toString()} l={l} market={market} signedIn={signedIn} usdtState={usdtState} running={run.running} exec={exec} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" data-testid="no-listings">{listings.isLoading ? "正在读取挂单…" : "暂时没有在售份额。"}</p>
      )}

      {!signedIn ? (
        <div style={{ marginTop: 12 }}><WalletButton signInLabel="签名登录后买卖" /></div>
      ) : (
        <>
          {myListings.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 className="h3" style={{ fontSize: ".95rem" }}>我的挂单</h3>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">我的挂单</caption>
                  <thead><tr><th>剩余</th><th className="r">每份价格（USDT）</th><th>截止</th><th><span className="sr-only">操作</span></th></tr></thead>
                  <tbody>
                    {myListings.map((l) => (
                      <tr key={l.id.toString()} data-testid={`my-listing-${l.id}`}>
                        <td>{l.units} 份</td>
                        <td className="r">{formatUsdt(l.pricePerUnit)}</td>
                        <td>{formatDate(l.expiresAt * 1000).slice(0, 10)}</td>
                        <td className="r">
                          <button
                            type="button"
                            className="btn ghost sm"
                            disabled={run.running}
                            onClick={() =>
                              exec(
                                [{ label: "撤销挂单", purpose: "MARKET_CANCEL", write: { address: market, abi: shareMarketAbi, functionName: "cancel", args: [l.id] } }],
                                "挂单已撤销。",
                              )
                            }
                          >
                            撤单
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
      <p className="fine" style={{ marginTop: 10 }}>价格由卖家自定，平台不收手续费，也不保证成交。成交前已结算的收益归卖家。</p>
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
  return (
    <>
      <tr data-testid={`listing-${l.id}`}>
        <td>{l.fillable} 份</td>
        <td className="r">{formatUsdt(l.pricePerUnit)}</td>
        <td>{formatDate(l.expiresAt * 1000).slice(0, 10)}</td>
        <td className="r">
          {signedIn && (
            <button type="button" className="btn ghost sm" aria-expanded={openBuy} onClick={() => setOpenBuy(!openBuy)}>
              购买
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
  const { usdt } = usePaymentSetup();
  const [units, setUnits] = useState(1);
  const [ack, setAck] = useState(false);
  const cost = l.pricePerUnit * BigInt(units);
  const needApproval = usdtState.allowance === undefined ? true : usdtState.allowance < cost;
  const reason = buyBlockReason({ eligible: elig.data?.eligibleNow, available: l.fillable, units, balance: usdtState.balance, cost, acknowledged: ack });

  const steps = useMemo<Step[]>(() => {
    if (!usdt) return [];
    const s: Step[] = [];
    if (needApproval) {
      s.push({ label: `授权 ${formatUsdt(cost)} USDT`, purpose: "APPROVE", write: { address: usdt, abi: erc20Abi, functionName: "approve", args: [market, cost] } });
    }
    s.push({
      label: `购买 ${units} 份`,
      purpose: "MARKET_BUY",
      write: { address: market, abi: shareMarketAbi, functionName: "buy", args: [l.id, units, l.pricePerUnit] },
    });
    return s;
  }, [usdt, needApproval, cost, market, l.id, l.pricePerUnit, units]);

  const set = (n: number) => setUnits(Math.max(1, Math.min(Math.max(l.fillable, 1), Math.floor(n) || 1)));

  return (
    <div style={{ display: "grid", gap: 10, padding: "8px 0" }}>
      <label htmlFor={`buy-units-${l.id}`} className="muted" style={{ fontSize: ".8rem" }}>购买份数</label>
      <div className="stepper">
        <button type="button" aria-label="减少一份" onClick={() => set(units - 1)} disabled={units <= 1}>−</button>
        <input id={`buy-units-${l.id}`} inputMode="numeric" value={units} onChange={(e) => set(Number(e.target.value))} />
        <button type="button" aria-label="增加一份" onClick={() => set(units + 1)} disabled={units >= l.fillable}>+</button>
      </div>
      <div className="line total"><span>应付</span><b>{formatUsdt(cost)} USDT</b></div>
      <label className="check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>我已阅读 <Link href="/risk" style={{ color: "var(--amber)" }}>投资须知</Link> 和项目条款</span>
      </label>
      <button type="button" className="btn primary" disabled={!!reason || running || steps.length === 0} onClick={() => exec(steps, `购买成功，${units} 份已到你的钱包。`)}>
        {needApproval ? "授权并购买" : "确认购买"}
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
  const [units, setUnits] = useState(1);
  const [priceText, setPriceText] = useState("");
  const [days, setDays] = useState<(typeof DURATIONS)[number]>(30);
  const parsed = sellInput(held, units, priceText);

  function list() {
    if ("error" in parsed) return;
    const s: Step[] = [];
    // One approval covers every unit held, so later listings need no extra step.
    if (unitAllowance < BigInt(held)) {
      s.push({ label: "授权转让市场出售份额", purpose: "APPROVE", write: { address: p.contracts.token!, abi: erc20Abi, functionName: "approve", args: [market, maxUint256] } });
    }
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + days * DAY);
    s.push({ label: `挂单 ${units} 份`, purpose: "MARKET_LIST", write: { address: market, abi: shareMarketAbi, functionName: "list", args: [p.id, units, parsed.price, expiresAt] } });
    void exec(s, "挂单成功，有人购买时 USDT 会直接到你的钱包。");
  }

  return (
    <div className="form" style={{ marginTop: 16 }}>
      <h3 className="h3" style={{ fontSize: ".95rem" }}>卖出我的份额（持有 {held} 份）</h3>
      <div className="row">
        <label className="field">
          <span>出售份数</span>
          <input inputMode="numeric" value={units} onChange={(e) => setUnits(Math.floor(Number(e.target.value)) || 0)} />
        </label>
        <label className="field">
          <span>每份价格（USDT）</span>
          <input inputMode="decimal" placeholder="例如 950" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
        </label>
        <label className="field">
          <span>挂单有效期</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof DURATIONS)[number])}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d} 天</option>)}
          </select>
        </label>
      </div>
      {"price" in parsed && <p className="muted" style={{ fontSize: ".84rem" }}>全部卖出可得 {formatUsdt(parsed.price * BigInt(units))} USDT</p>}
      <button type="button" className="btn primary" style={{ marginTop: 8 }} disabled={"error" in parsed || running} onClick={list}>
        挂单出售
      </button>
      {"error" in parsed && priceText !== "" && <p className="muted" style={{ fontSize: ".8rem" }}>{parsed.error}</p>}
    </div>
  );
}
