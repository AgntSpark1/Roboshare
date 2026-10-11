"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ProjectDetail, type ProjectListItem } from "@roboshare/ui";

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
