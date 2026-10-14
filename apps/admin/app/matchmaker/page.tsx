"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { api, formatDate, formatUsdt, shortAddr, type SafeProposal } from "@roboshare/ui";
import { ProposalView } from "@/components/Proposal";
import { explorer } from "@/env";
import { errorText, useRoles } from "@/lib/admin";
import { matchText, useMatchmaker, type MatchmakerSettings, type QueuedVehicle } from "@/lib/data";

type Editable = Pick<MatchmakerSettings, "launchEnabled" | "launchMode" | "maxOpen" | "demoVehicles" | "backstopEnabled" | "backstopHoursBeforeEnd" | "backstopMaxUsdt" | "autoActivate">;

const STATUS: Record<QueuedVehicle["status"], string> = {
  QUEUED: "排队中",
  REGISTERING: "登记中",
  WAITING_SAFE: "等多签确认",
  LISTED: "已上架",
  FAILED: "失败",
};

/** Robot matchmaking: list the next vehicle automatically and let the platform buy the unsold units near the deadline. */
export default function Matchmaker() {
  const q = useMatchmaker();
  const qc = useQueryClient();
  const { can } = useRoles();
  const d = q.data;
  const [f, setF] = useState<Editable | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [proposal, setProposal] = useState<SafeProposal | null>(null);
  const [tpl, setTpl] = useState({ unitPriceUsdt: "100", minUnits: "10", perWalletMax: "100", durationDays: "7", termDays: "720", minLaunchIntervalMinutes: "60" });
  const [v, setV] = useState({ slug: "", title: "", make: "", model: "", assetRef: "" });

  useEffect(() => {
    if (d && !f) {
      const s = d.settings;
      setF({ launchEnabled: s.launchEnabled, launchMode: s.launchMode, maxOpen: s.maxOpen, demoVehicles: s.demoVehicles, backstopEnabled: s.backstopEnabled, backstopHoursBeforeEnd: s.backstopHoursBeforeEnd, backstopMaxUsdt: s.backstopMaxUsdt, autoActivate: s.autoActivate });
      const t = s.template;
      if (t?.enabled) {
        setTpl({ unitPriceUsdt: (BigInt(t.unitPrice) / 10n ** 18n).toString(), minUnits: `${t.minUnits}`, perWalletMax: `${t.perWalletMax}`, durationDays: `${t.durationDays}`, termDays: `${t.termDays}`, minLaunchIntervalMinutes: `${Math.round(t.minLaunchInterval / 60)}` });
      }
    }
  }, [d, f]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "matchmaker"] });
  async function run(fn: () => Promise<void>) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setErr(errorText(e));
    }
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api.put("/admin/matchmaker/settings", f);
      setMsg("已保存，后台程序 30 秒内按新设置运行。");
      await refresh();
    });
  };
  const setup = (enabled: boolean) => run(async () => {
    if (!enabled && !window.confirm("关闭后不会再自动上架新车（已上架的不受影响）。确定？")) return;
    const n = (k: keyof typeof tpl) => Number(tpl[k]);
    const body = { enabled, unitPriceUsdt: n("unitPriceUsdt"), minUnits: n("minUnits"), perWalletMax: n("perWalletMax"), durationDays: n("durationDays"), termDays: n("termDays"), minLaunchIntervalMinutes: n("minLaunchIntervalMinutes") };
    setProposal((await api.post<{ proposal: SafeProposal }>("/admin/matchmaker/setup", body)).proposal);
  });
  const addVehicle = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api.post("/admin/matchmaker/vehicles", { slug: v.slug, title: v.title, make: v.make || undefined, model: v.model || undefined, assetRef: v.assetRef });
      setV({ slug: "", title: "", make: "", model: "", assetRef: "" });
      setMsg("已加入排队。");
      await refresh();
    });
  };
  const remove = (id: string) => run(async () => {
    await api.del(`/admin/matchmaker/vehicles/${id}`);
    await refresh();
  });

  const t = d?.settings.template;
  const s = d?.settings;
  const bool = (k: keyof Editable) => ({ checked: !!f?.[k], onChange: (e: { target: { checked: boolean } }) => setF((x) => x && { ...x, [k]: e.target.checked }) });
  const num = (k: keyof Editable) => ({ value: `${f?.[k] ?? ""}`, inputMode: "numeric" as const, onChange: (e: { target: { value: string } }) => setF((x) => x && { ...x, [k]: Number(e.target.value) || 0 }) });

  return (
    <>
      <section className="panel" aria-labelledby="mm">
        <h2 id="mm">撮合系统</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>
          一辆车卖完，系统自动上架下一辆。募集最后阶段还没卖完时，平台钱包用平台自己的 USDT 一次性认购剩余份额，满额后自动结算，再提醒多签确认投入运营。募集期间平台不会提前买入，也不会拆成多个钱包认购。
        </p>
        {q.error && <p className="err" role="alert">{errorText(q.error)}</p>}
        {d && s && (
          <div className="health">
            <div><span>自动上架</span><b className={s.launchEnabled && d.ready.launch ? "c-good" : "c-warn"}>{!s.launchEnabled ? "已关闭" : d.ready.launch ? (s.launchMode === "AUTO" ? "运行中（全自动）" : "运行中（每辆车多签确认）") : "等待多签授权"}</b></div>
            <div><span>平台补齐</span><b className={s.backstopEnabled && d.ready.backstop ? "c-good" : "c-warn"}>{!s.backstopEnabled ? "已关闭" : d.ready.backstop ? `截止前 ${s.backstopHoursBeforeEnd} 小时内一次性补齐` : "后台程序未配置平台钱包"}</b></div>
            <div><span>上架模板</span><span>{t?.enabled ? `每份 ${formatUsdt(t.unitPrice)} USDT · 共 100 份 · 最少 ${t.minUnits} 份成立 · 募集 ${t.durationDays} 天 · 运营期 ${t.termDays} 天` : "未设置"}</span></div>
            <div><span>上新车钱包</span><span className="mono">{s.launcherAddress ? shortAddr(s.launcherAddress) : "—"}</span></div>
            <div><span>核验钱包</span><span className="mono">{s.verifierAddress ? shortAddr(s.verifierAddress) : "—"}</span></div>
            <div><span>平台认购钱包</span><span className="mono">{s.backstopAddress ? shortAddr(s.backstopAddress) : "—"}</span></div>
          </div>
        )}
      </section>

      {f && (
        <section className="panel" aria-labelledby="sw">
          <h2 id="sw">开关</h2>
          <form className="form" onSubmit={save}>
            <div className="fgrid">
              <label className="field"><span>自动上架新车</span><input type="checkbox" {...bool("launchEnabled")} /></label>
              <label className="field"><span>上架方式</span>
                <select value={f.launchMode} onChange={(e) => setF({ ...f, launchMode: e.target.value as "AUTO" | "SAFE" })}>
                  <option value="AUTO">全自动（上新车钱包直接上架）</option>
                  <option value="SAFE">每辆车多签确认</option>
                </select>
              </label>
              <label className="field"><span>同时在售车辆数</span><input {...num("maxOpen")} /></label>
              <label className="field"><span>排队为空时自动生成演示车（仅测试网）</span><input type="checkbox" {...bool("demoVehicles")} /></label>
              <label className="field"><span>平台补齐剩余份额</span><input type="checkbox" {...bool("backstopEnabled")} /></label>
              <label className="field"><span>截止前多少小时补齐</span><input {...num("backstopHoursBeforeEnd")} /></label>
              <label className="field"><span>单个项目平台最多认购（USDT）</span><input {...num("backstopMaxUsdt")} /></label>
              <label className="field"><span>满额后提醒多签投入运营</span><input type="checkbox" {...bool("autoActivate")} /></label>
            </div>
            {can("OPERATOR", "GOV_VIEW") && <div><button type="submit" className="btn primary sm">保存</button></div>}
          </form>
          {msg && <p className="okmsg" role="status">{msg}</p>}
          {err && <p className="err" role="alert">{err}</p>}
        </section>
      )}

      <section className="panel" aria-labelledby="tp">
        <h2 id="tp">上架模板与授权（多签）</h2>
        <p className="muted small" style={{ marginBottom: 8 }}>
          自动上架的车辆都按这个模板开放认购，上新车钱包不能改价格、份数、期限和收款账户。生成的多签交易会一并补齐撮合钱包缺少的权限，多签随时可以关闭。
        </p>
        <div className="fgrid">
          <label className="field"><span>每份价格（USDT）</span><input value={tpl.unitPriceUsdt} inputMode="numeric" onChange={(e) => setTpl({ ...tpl, unitPriceUsdt: e.target.value })} /></label>
          <label className="field"><span>最少成立份数</span><input value={tpl.minUnits} inputMode="numeric" onChange={(e) => setTpl({ ...tpl, minUnits: e.target.value })} /></label>
          <label className="field"><span>单个钱包最多份数</span><input value={tpl.perWalletMax} inputMode="numeric" onChange={(e) => setTpl({ ...tpl, perWalletMax: e.target.value })} /></label>
          <label className="field"><span>募集天数</span><input value={tpl.durationDays} inputMode="numeric" onChange={(e) => setTpl({ ...tpl, durationDays: e.target.value })} /></label>
          <label className="field"><span>运营期（天）</span><input value={tpl.termDays} inputMode="numeric" onChange={(e) => setTpl({ ...tpl, termDays: e.target.value })} /></label>
          <label className="field"><span>两次上架最短间隔（分钟）</span><input value={tpl.minLaunchIntervalMinutes} inputMode="numeric" onChange={(e) => setTpl({ ...tpl, minLaunchIntervalMinutes: e.target.value })} /></label>
        </div>
        {can("OPERATOR", "GOV_VIEW") && (
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn primary sm" onClick={() => setup(true)}>生成多签交易：设置模板并授权</button>
            <button type="button" className="btn danger sm" onClick={() => setup(false)}>关闭自动上架</button>
          </div>
        )}
        {proposal && <div style={{ marginTop: 12 }}><ProposalView proposal={proposal} /></div>}
      </section>

      <section className="panel" aria-labelledby="vq">
        <h2 id="vq">待上架车辆</h2>
        {can("OPERATOR") && (
          <form className="form" onSubmit={addVehicle} style={{ marginBottom: 12 }}>
            <div className="fgrid">
              <label className="field"><span>名称</span><input value={v.title} maxLength={64} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="比亚迪 e6 #0002" /></label>
              <label className="field"><span>网址名（小写字母、数字、-）</span><input value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase() })} placeholder="byd-e6-0002" /></label>
              <label className="field"><span>品牌</span><input value={v.make} onChange={(e) => setV({ ...v, make: e.target.value })} /></label>
              <label className="field"><span>车型</span><input value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} /></label>
              <label className="field"><span>车辆编号参考（VIN 加盐哈希，只有哈希上链）</span><input value={v.assetRef} onChange={(e) => setV({ ...v, assetRef: e.target.value })} /></label>
            </div>
            <div><button type="submit" className="btn primary sm" disabled={!v.title || !v.slug || v.assetRef.length < 8}>加入排队</button></div>
          </form>
        )}
        {!d?.queue.length && <p className="empty">没有排队的车辆。{s?.demoVehicles ? "测试网会自动生成演示车。" : ""}</p>}
        {!!d?.queue.length && (
          <div className="tw">
            <table>
              <thead><tr><th>车辆</th><th>状态</th><th>加入时间</th><th /></tr></thead>
              <tbody>
                {d.queue.map((x) => (
                  <tr key={x.id}>
                    <td>{x.title}{x.demo ? "（演示）" : ""}</td>
                    <td className={x.status === "FAILED" ? "c-warn" : x.status === "LISTED" ? "c-good" : ""}>{STATUS[x.status]}{x.lastError ? `：${x.lastError}` : ""}</td>
                    <td>{formatDate(x.createdAt)}</td>
                    <td>{can("OPERATOR") && ["QUEUED", "FAILED"].includes(x.status) && <button type="button" className="btn sm" onClick={() => remove(x.id)}>移除</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="lg">
        <h2 id="lg">执行记录</h2>
        {!d?.events.length && <p className="empty">还没有记录。</p>}
        {d?.events.map((e) => (
          <div className="q" key={e.id}>
            <span className="ic" aria-hidden="true">{e.kind.startsWith("BACKSTOP") ? "补" : e.kind.startsWith("VEHICLE") || e.kind === "LAUNCH_QUEUED" ? "车" : "!"}</span>
            <div>
              <h3 className="h4">{matchText(e)}</h3>
              <small>
                {formatDate(e.createdAt)}
                {e.txHash && explorer && <> · <a href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">查看交易</a></>}
              </small>
            </div>
            <span />
          </div>
        ))}
      </section>
    </>
  );
}
