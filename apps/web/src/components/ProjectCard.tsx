"use client";
import Link from "next/link";
import { formatUsdt, OfferingProgress, StatePill, countdown, type ProjectListItem } from "@roboshare/ui";
import { CarArt } from "./CarArt";

export function projectCode(p: { slug: string | null; id: string }) {
  return (p.slug ?? p.id.slice(2, 8)).toUpperCase();
}

export function ProjectCard({ p }: { p: ProjectListItem }) {
  const code = projectCode(p);
  const o = p.offering;
  return (
    <Link className={`pcard${p.state === "OFFERING" ? " hot" : ""}`} href={`/projects/${p.id}`}>
      <div className="art">
        <CarArt id={p.id} code={code} />
      </div>
      <div className="body">
        <div className="t">
          <div>
            <div className="code">{code}</div>
            <h3>{p.title ?? "未命名项目"}</h3>
          </div>
          <StatePill state={p.state} />
        </div>
        <div className="kv">
          <div>
            <span>每份价格</span>
            <b>{o ? `${formatUsdt(o.unitPrice)} USDT` : "待定"}</b>
          </div>
          <div>
            <span>车型</span>
            <b style={{ fontFamily: "var(--f-body)", fontSize: ".84rem", fontWeight: 500 }}>{[p.make, p.model].filter(Boolean).join(" ") || "—"}</b>
          </div>
        </div>
        {p.state === "OFFERING" && o ? (
          <>
            <OfferingProgress sold={o.unitsSold} min={o.minUnits} max={o.maxUnits} />
            <div className="line">
              <span className="muted">剩余时间</span>
              <b className="mono">{countdown(o.endAt)}</b>
            </div>
          </>
        ) : (
          <div className="line">
            <span className="muted">已发行份额</span>
            <b>{p.issuedUnits} / {p.authorizedUnits} 份</b>
          </div>
        )}
      </div>
    </Link>
  );
}
