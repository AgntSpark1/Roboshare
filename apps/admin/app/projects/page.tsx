"use client";
import { useState } from "react";
import { keccak256, stringToHex } from "viem";
import { api, shortAddr, StatePill, type PreparedTx, type SafeProposal } from "@roboshare/ui";
import { ProposalView } from "@/components/Proposal";
import { TxAction } from "@/components/TxAction";
import { errorText, useRoles } from "@/lib/admin";
import { projectName, useProjects, useRefresh } from "@/lib/data";

export default function Projects() {
  const projects = useProjects();
  const { can } = useRoles();
  const refresh = useRefresh();
  const [proposal, setProposal] = useState<SafeProposal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      {can("OPERATOR") && <CreateProject onDone={refresh} />}
      <section className="panel" aria-labelledby="list">
        <h2 id="list">全部项目</h2>
        <div className="tw">
          <table>
            <thead><tr><th>项目</th><th>状态</th><th>项目 ID</th><th>操作</th></tr></thead>
            <tbody>
              {(projects.data?.items ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{projectName(p)}</td>
                  <td><StatePill state={p.state} /></td>
                  <td className="hash">{shortAddr(p.id, 10, 6)}</td>
                  <td>
                    <div className="row">
                      {p.state === "DRAFT" && can("REVIEWER") && (
                        <TxAction
                          label="核验通过（VERIFIED）"
                          className="btn good sm"
                          prepare={async () => (await api.post<{ tx: PreparedTx }>(`/admin/projects/${p.id}/transition`, { to: "VERIFIED", reason: "KYB and documents checked" })).tx}
                          onDone={refresh}
                        />
                      )}
                      {p.state === "FUNDED" && can("GOV_VIEW") && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={async () => {
                            setErr(null);
                            try {
                              setProposal((await api.post<{ proposal: SafeProposal }>(`/admin/projects/${p.id}/transition`, { to: "ACTIVE", reason: "vehicle in service" })).proposal);
                            } catch (e) {
                              setErr(errorText(e));
                            }
                          }}
                        >
                          生成投运提案（ACTIVE）
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
      </section>
      {proposal && <ProposalView proposal={proposal} />}
    </>
  );
}

function CreateProject({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ slug: "", title: "", make: "", model: "", summary: "", assetRef: "", rightsDoc: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="panel" aria-labelledby="create">
      <h2 id="create">登记新车辆项目</h2>
      <div className="form">
        <div className="fgrid">
          <label className="field"><span>项目代号（小写字母、数字、-）</span><input value={f.slug} onChange={set("slug")} placeholder="rs-003" /></label>
          <label className="field"><span>项目名称</span><input value={f.title} onChange={set("title")} /></label>
          <label className="field"><span>品牌</span><input value={f.make} onChange={set("make")} /></label>
          <label className="field"><span>车型</span><input value={f.model} onChange={set("model")} /></label>
          <label className="field"><span>车辆引用（加盐 VIN 等，仅哈希上链）</span><input value={f.assetRef} onChange={set("assetRef")} /></label>
          <label className="field"><span>权益文件内容（或其版本号，哈希上链）</span><input value={f.rightsDoc} onChange={set("rightsDoc")} /></label>
        </div>
        <label className="field"><span>简介</span><textarea value={f.summary} onChange={set("summary")} /></label>
        <TxAction
          label="登记并上链（运营钱包签名）"
          disabled={!f.slug || !f.title || f.assetRef.length < 8 || !f.rightsDoc}
          prepare={async () =>
            (
              await api.post<{ tx: PreparedTx }>("/admin/projects", {
                slug: f.slug,
                title: f.title,
                make: f.make || undefined,
                model: f.model || undefined,
                summary: f.summary || undefined,
                assetRef: f.assetRef,
                issuerId: keccak256(stringToHex("roboshare-issuer")),
                rightsDocHash: keccak256(stringToHex(f.rightsDoc)),
              })
            ).tx
          }
          onDone={onDone}
        />
      </div>
    </section>
  );
}
