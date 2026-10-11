"use client";
import { useState } from "react";
import { api, formatDate, shortAddr, type PreparedTx } from "@roboshare/ui";
import { TxAction } from "@/components/TxAction";
import { errorText, useRoles } from "@/lib/admin";
import { useInvestors, useRefresh, type InvestorRow } from "@/lib/data";

const STATUS: Record<InvestorRow["status"], { text: string; cls: string }> = {
  NONE: { text: "未开通", cls: "c-warn" },
  ELIGIBLE: { text: "已开通", cls: "c-good" },
  EXPIRED: { text: "已过期", cls: "c-warn" },
  FROZEN: { text: "已冻结", cls: "c-bad" },
};

/** Investor eligibility (whitelist). No real KYC yet: the compliance wallet records a manual decision on-chain. */
export default function Investors() {
  const q = useInvestors();
  const { can } = useRoles();
  const refresh = useRefresh();
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [days, setDays] = useState("365");
  const [manual, setManual] = useState("");
  const maxBatch = q.data?.maxBatch ?? 50;
  const all = (q.data?.items ?? []).filter((i) => !i.staff);
  const rows = tab === "pending" ? all.filter((i) => i.status === "NONE" || i.status === "EXPIRED") : all;
  const extra = manual.split(/[\s,，]+/).filter((s) => /^0x[0-9a-fA-F]{40}$/.test(s));
  const chosen = [...new Set([...picked, ...extra])];
  const toggle = (w: string) => setPicked((p) => { const n = new Set(p); n.has(w) ? n.delete(w) : n.add(w); return n; });
  const selectable = rows.filter((r) => r.status !== "ELIGIBLE" && r.status !== "FROZEN");
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(r.wallet));

  return (
    <>
      <section className="panel" aria-labelledby="inv">
        <h2 id="inv">投资者资格</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>
          投资者登录网站后会出现在这里。开通资格后才能认购。目前没有接入实名认证（KYC），开通即代表运营方人工审核通过；正式公开发行前必须接入真实 KYC。
        </p>
        <div className="row" style={{ marginBottom: 8 }}>
          <button type="button" className={tab === "pending" ? "btn primary sm" : "btn sm"} onClick={() => setTab("pending")}>待开通（{q.data?.counts.pending ?? "—"}）</button>
          <button type="button" className={tab === "all" ? "btn primary sm" : "btn sm"} onClick={() => setTab("all")}>全部（{all.length}）</button>
        </div>
        {q.error && <p className="err" role="alert">{errorText(q.error)}</p>}
        {!q.isLoading && rows.length === 0 && <p className="empty">{tab === "pending" ? "没有待开通的投资者。" : "还没有投资者登录过。"}</p>}
        {rows.length > 0 && (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>
                    {can("COMPLIANCE") && (
                      <input type="checkbox" aria-label="全选" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(selectable.slice(0, maxBatch).map((r) => r.wallet)))} />
                    )}
                  </th>
                  <th>钱包</th><th>资格</th><th className="r">认购/持有</th><th>首次登录</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.wallet} data-testid={`investor-${r.wallet}`}>
                    <td>
                      {can("COMPLIANCE") && r.status !== "ELIGIBLE" && r.status !== "FROZEN" && (
                        <input type="checkbox" aria-label={`选择 ${r.wallet}`} checked={picked.has(r.wallet)} onChange={() => toggle(r.wallet)} />
                      )}
                    </td>
                    <td className="mono" title={r.wallet}>{shortAddr(r.wallet)}</td>
                    <td>
                      <span className={STATUS[r.status].cls}>{STATUS[r.status].text}</span>
                      {r.expiresAt && r.status === "ELIGIBLE" && <small className="muted"> · 到期 {formatDate(r.expiresAt)}</small>}
                    </td>
                    <td className="r">{r.subscribedUnits} / {r.heldUnits}</td>
                    <td>{formatDate(r.linkedAt)}</td>
                    <td>
                      {can("COMPLIANCE") && r.status === "ELIGIBLE" && (
                        <TxAction
                          label="撤销"
                          className="btn danger sm"
                          confirm={`撤销 ${shortAddr(r.wallet)} 的资格？撤销后不能再认购。`}
                          prepare={async () => {
                            const reason = window.prompt("撤销原因（记入审计日志）") ?? "";
                            if (reason.trim().length < 3) throw new Error("请填写至少 3 个字的原因。");
                            return (await api.post<{ tx: PreparedTx }>("/admin/eligibility/revoke", { wallet: r.wallet, reason: reason.trim() })).tx;
                          }}
                          onDone={refresh}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {can("COMPLIANCE") ? (
        <section className="panel" aria-labelledby="grant">
          <h2 id="grant">批量开通</h2>
          <div className="form">
            <label className="field">
              <span>也可以直接粘贴钱包地址（空格或逗号分隔）</span>
              <textarea value={manual} onChange={(e) => setManual(e.target.value)} placeholder="0x…" rows={2} />
            </label>
            <label className="field" style={{ maxWidth: 220 }}>
              <span>有效天数（0 为不过期）</span>
              <input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
            </label>
            <p className="small">已选 <b>{chosen.length}</b> 个钱包{chosen.length > maxBatch ? `，一次最多 ${maxBatch} 个` : ""}。</p>
            <TxAction
              label={`开通 ${chosen.length} 个钱包（合规钱包签名一次）`}
              disabled={chosen.length === 0 || chosen.length > maxBatch || days === ""}
              prepare={async () => (await api.post<{ tx: PreparedTx }>("/admin/eligibility", { wallets: chosen, days: Number(days) })).tx}
              onDone={() => { setPicked(new Set()); setManual(""); refresh(); }}
            />
          </div>
        </section>
      ) : (
        <p className="muted small">开通或撤销资格需要合规角色的钱包。</p>
      )}
    </>
  );
}
