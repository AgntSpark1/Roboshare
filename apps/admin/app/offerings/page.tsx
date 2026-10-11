"use client";
import { useState } from "react";
import { keccak256, stringToHex, isAddress } from "viem";
import { api, countdown, useChainNow, formatUsdt, OfferingProgress, parseUsdt, type PreparedTx, type SafeProposal } from "@roboshare/ui";
import { SHARE_CAP } from "@roboshare/shared";
import { ProposalView } from "@/components/Proposal";
import { TxAction } from "@/components/TxAction";
import { errorText, useRoles } from "@/lib/admin";
import { projectName, useProjects, useRefresh } from "@/lib/data";

export default function Offerings() {
  const projects = useProjects();
  const { can } = useRoles();
  const refresh = useRefresh();
  const now = useChainNow();
  const items = projects.data?.items ?? [];
  const open = items.filter((p) => p.state === "OFFERING" && p.offering);
  const verified = items.filter((p) => p.state === "VERIFIED");
  return (
    <>
      <section className="panel" aria-labelledby="open">
        <h2 id="open">募集中</h2>
        {open.length === 0 && <p className="empty">没有募集中的项目。</p>}
        {open.map((p) => {
          const o = p.offering!;
          const ended = now >= new Date(o.endAt).getTime();
          const ready = o.unitsSold >= o.minUnits && (ended || o.unitsSold >= o.maxUnits);
          return (
            <div className="q" key={p.id} data-testid={`offering-${p.slug ?? p.id}`}>
              <span className="ic" aria-hidden="true">募</span>
              <div className="stack" style={{ gap: 6 }}>
                <h3 className="h4">{projectName(p)} · 每份 {formatUsdt(o.unitPrice)} USDT</h3>
                <OfferingProgress sold={o.unitsSold} min={o.minUnits} max={o.maxUnits} />
                <small>{ended ? "募集期已结束" : `剩余 ${countdown(o.endAt, now)}`} · {ready ? "可以结算" : o.unitsSold < o.minUnits ? "未达最低份数" : "募集期结束或售罄后才能结算"}</small>
              </div>
              {can("OPERATOR") ? (
                <TxAction
                  label="结算募集"
                  disabled={!ready}
                  confirm={`结算 ${projectName(p)}：发行 ${o.unitsSold} 份并把募集款转入项目资金账户。确定？`}
                  prepare={async () => (await api.post<{ tx: PreparedTx }>(`/admin/offerings/${p.id}/settle`)).tx}
                  onDone={refresh}
                />
              ) : (
                <span className="lab">需运营角色</span>
              )}
            </div>
          );
        })}
      </section>
      {can("GOV_VIEW") && verified.length > 0 && <ConfigureOffering projects={verified.map((p) => ({ id: p.id, name: projectName(p) }))} />}
    </>
  );
}

function ConfigureOffering({ projects }: { projects: { id: string; name: string }[] }) {
  const [f, setF] = useState({ id: projects[0]!.id, price: "500", min: "60", perWallet: "", days: "14", treasury: "", terms: "" });
  const [proposal, setProposal] = useState<SafeProposal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function make() {
    setErr(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const r = await api.post<{ proposal: SafeProposal }>(`/admin/projects/${f.id}/offering`, {
        unitPrice: parseUsdt(f.price).toString(),
        minUnits: Number(f.min),
        // Blank means no per-wallet cap: the contract caps at the total units.
        perWalletMax: f.perWallet.trim() ? Number(f.perWallet) : SHARE_CAP,
        // No timelock: the offering opens as soon as the Safe executes, so the window starts now.
        startTime: now,
        endTime: now + Number(f.days) * 86_400,
        treasury: f.treasury,
        termsHash: keccak256(stringToHex(f.terms)),
      });
      setProposal(r.proposal);
    } catch (e) {
      setErr(errorText(e));
    }
  }
  return (
    <section className="panel" aria-labelledby="cfg">
      <h2 id="cfg">开启募集（治理提案）</h2>
      <div className="form">
        <div className="fgrid">
          <label className="field"><span>项目</span>
            <select value={f.id} onChange={set("id")}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className="field"><span>每份价格（USDT）</span><input value={f.price} onChange={set("price")} inputMode="decimal" /></label>
          <label className="field"><span>最低成功份数（1–100）</span><input value={f.min} onChange={set("min")} inputMode="numeric" /></label>
          <label className="field"><span>每钱包上限（留空为不限）</span><input value={f.perWallet} onChange={set("perWallet")} inputMode="numeric" placeholder="不限" /></label>
          <label className="field"><span>募集天数（Safe 执行后立即开始）</span><input value={f.days} onChange={set("days")} inputMode="numeric" /></label>
          <label className="field"><span>项目资金账户地址</span><input value={f.treasury} onChange={set("treasury")} placeholder="0x…" /></label>
        </div>
        <label className="field"><span>募集条款内容或版本号（哈希上链）</span><input value={f.terms} onChange={set("terms")} /></label>
        <div><button type="button" className="btn primary sm" disabled={!isAddress(f.treasury) || !f.terms} onClick={make}>生成 Safe 提案</button></div>
        {err && <p className="err" role="alert">{err}</p>}
      </div>
      {proposal && <div style={{ marginTop: 14 }}><ProposalView proposal={proposal} /></div>}
    </section>
  );
}
