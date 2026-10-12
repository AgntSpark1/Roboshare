"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatUsdt, type ProjectDetail, type ProjectListItem } from "@roboshare/ui";

export interface ReportRow {
  id: string;
  projectIdOnchain: string;
  periodStart: string;
  periodEnd: string;
  grossRevenue: string;
  totalExpenses: string;
  totalReserves: string;
  distributableAmount: string;
  canonicalHash: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  submittedByWallet: string;
  submittedAt: string;
  recordIdOnchain: string | null;
  figureKind: string;
  reviews: { decision: string; reason: string | null; decidedAt: string }[];
}

export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ items: ProjectListItem[] }>("/projects") });
export const useProject = (id: string | undefined) =>
  useQuery({ queryKey: ["project", id], enabled: !!id, queryFn: () => api.get<ProjectDetail>(`/projects/${id}`) });
export const useReports = (status?: string) =>
  useQuery({ queryKey: ["admin", "reports", status ?? "all"], queryFn: () => api.get<{ items: ReportRow[] }>(`/admin/reports${status ? `?status=${status}` : ""}`) });
export interface AutomationEvent {
  id: string;
  projectIdOnchain: string;
  kind: string;
  message: string;
  txHash: string | null;
  createdAt: string;
}

export interface AutopilotStatus {
  configured: boolean;
  submitter: string | null;
  approver: string | null;
  ready: boolean;
  contracts: { kind: string; label: string; address: string; submitterOk: boolean; approverOk: boolean }[];
  events: AutomationEvent[];
  issues: AutomationEvent[];
}

export const useAutopilot = () =>
  useQuery({ queryKey: ["admin", "autopilot"], refetchInterval: 30_000, queryFn: () => api.get<AutopilotStatus>("/admin/autopilot") });

/** Chinese line for an autopilot event (the worker logs short English messages with base-unit amounts). */
export function eventText(e: Pick<AutomationEvent, "kind" | "message">): string {
  const n = (v: string | undefined) => (v ? `${formatUsdt(v)} USDT` : "");
  let m: RegExpMatchArray | null;
  switch (e.kind) {
    case "REPORT_SUBMITTED":
      m = e.message.match(/^(\d{4}-\d{2}) report: revenue (\d+), expenses (\d+)/);
      return m ? `${m[1]} 运营报告已上链：收入 ${n(m[2])}，支出 ${n(m[3])}` : "运营报告已上链";
    case "REPORT_APPROVED":
      m = e.message.match(/^(\d{4}-\d{2})/);
      return `${m ? `${m[1]} ` : ""}运营报告已自动审核`;
    case "BATCH_PROPOSED":
      m = e.message.match(/^(\d{4}-\d{2}): (\d+) to (\d+)/);
      return m ? `${m[1]} 收益分配已生成：${n(m[2])}，${m[3]} 位持有人` : "收益分配已生成";
    case "BATCH_APPROVED":
      return "收益已开放领取";
    case "TREASURY_SHORT":
      m = e.message.match(/needs (\d+)/);
      return `资金账户余额或授权不足${m ? `，需要 ${n(m[1])}` : ""}，补足后自动发放`;
    case "OVER_CAP":
      return "本月金额超过自动分配上限，请在“分配批次”里人工发起";
    case "LOSS_MONTH":
      return "本月支出大于收入，没有可分配收益";
    case "RECONCILIATION_BLOCKED":
      return "对账发现差异，分配暂停，处理后自动继续";
    default:
      return `自动分配出错：${e.message}`;
  }
}

export const useHealth = () =>
  useQuery({ queryKey: ["health"], refetchInterval: 10_000, queryFn: () => api.get<{ indexer: { lastBlock: string; updatedAt: string } | null }>("/health") });

/** The indexer confirms a few seconds after the wallet; refresh API views a couple of times. */
export function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries();
    for (const ms of [2000, 5000, 10000]) setTimeout(() => void qc.invalidateQueries(), ms);
  };
}

export function projectName(p: { title?: string | null; meta?: { title: string } | null; slug?: string | null; id: string } | undefined) {
  if (!p) return "—";
  return p.title ?? p.meta?.title ?? p.slug ?? p.id.slice(0, 10);
}

import { readContract } from "@wagmi/core";
import { subscriptionRouterAbi } from "@roboshare/shared";
import { contractOf, useWalletConfig, type ContractsResponse } from "@roboshare/ui";
import type { Address } from "viem";

export const useContracts = () => useQuery({ queryKey: ["contracts"], staleTime: 300_000, queryFn: () => api.get<ContractsResponse>("/contracts") });

/** The platform USDT, read from the SubscriptionRouter (the API rejects reports in any other token). */
export function useUsdt() {
  const config = useWalletConfig();
  const router = contractOf(useContracts().data, "SUBSCRIPTION_ROUTER");
  return useQuery({
    queryKey: ["usdt", router],
    enabled: !!router,
    staleTime: Infinity,
    queryFn: () => readContract(config, { address: router!, abi: subscriptionRouterAbi, functionName: "USDT" }) as Promise<Address>,
  });
}
