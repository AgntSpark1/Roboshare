"use client";
import { useState } from "react";
import { ProjectCard } from "@/components/ProjectCard";
import { useProjects } from "@/lib/data";

const FILTERS: [string, string][] = [
  ["all", "全部"],
  ["OFFERING", "募集中"],
  ["ACTIVE", "运营中"],
  ["FUNDED", "待投运"],
  ["VERIFIED", "即将开放"],
  ["CANCELLED", "已取消"],
];

export default function Projects() {
  const [filter, setFilter] = useState("all");
  const q = useProjects();
  const items = (q.data?.items ?? []).filter((p) => filter === "all" || p.state === filter);
  return (
    <section>
      <div className="wrap">
        <div className="sec-h">
          <h1 className="h2">车辆项目</h1>
          <p>每个项目对应一辆车，按份认购，按期领取收益。</p>
        </div>
        <div className="filters" role="group" aria-label="按状态筛选">
          {FILTERS.map(([k, v]) => (
            <button key={k} type="button" className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {v}
            </button>
          ))}
        </div>
        {q.isLoading ? (
          <p className="muted">正在加载项目…</p>
        ) : q.error ? (
          <p className="err" role="alert">项目暂时加载不出来，请稍后刷新。</p>
        ) : items.length === 0 ? (
          <div className="panel empty"><p className="muted">这个分类下暂时没有项目。</p></div>
        ) : (
          <div className="grid">{items.map((p) => <ProjectCard key={p.id} p={p} />)}</div>
        )}
      </div>
    </section>
  );
}
