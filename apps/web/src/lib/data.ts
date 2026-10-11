"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getBalance, readContract } from "@wagmi/core";
import { erc20Abi, type Address } from "viem";
import { subscriptionRouterAbi } from "@roboshare/shared";
import { api, contractOf, useSession, useWalletConfig, type ContractsResponse, type ProjectDetail, type ProjectListItem } from "@roboshare/ui";

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ items: ProjectListItem[] }>("/projects") });
}

export function useProject(id: string) {
  return useQuery({ queryKey: ["project", id], queryFn: () => api.get<ProjectDetail>(`/projects/${id}`), enabled: /^0x[0-9a-fA-F]{64}$/.test(id) });
}

export interface FinancialItem {
  figureKind: "ACTUAL";
  recordId: string;
  periodStart: string;
  periodEnd: string;
  distributableAmount: string;
  grossRevenue: string | null;
  totalExpenses: string | null;
  totalReserves: string | null;
  assuranceLevel: string;
  contentHash: string;
}

export function useFinancials(id: string) {
  return useQuery({ queryKey: ["financials", id], queryFn: () => api.get<{ items: FinancialItem[] }>(`/projects/${id}/financials`) });
}

export interface BatchItem {
  batchId: number;
  amount: string;
  pool: string;
  totalNet: string;
  totalFee: string;
  snapshotBlock: string;
  chain: { txHash: string | null };
}

export function useProjectDistributions(id: string) {
  return useQuery({ queryKey: ["distributions", id], queryFn: () => api.get<{ items: BatchItem[] }>(`/projects/${id}/distributions`) });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<{ chainId: number; indexer: { lastBlock: string } | null }>("/health"),
    refetchInterval: 15_000,
  });
}

export function useContracts() {
  return useQuery({ queryKey: ["contracts"], queryFn: () => api.get<ContractsResponse>("/contracts"), staleTime: 300_000 });
}

/** SubscriptionRouter and the USDT it pulls from (read from the router itself, never hard-coded). */
export function usePaymentSetup() {
  const config = useWalletConfig();
  const contracts = useContracts();
  const router = contractOf(contracts.data, "SUBSCRIPTION_ROUTER");
  const usdt = useQuery({
    queryKey: ["usdt", router],
    enabled: !!router,
    staleTime: Infinity,
    queryFn: () => readContract(config, { address: router!, abi: subscriptionRouterAbi, functionName: "USDT" }) as Promise<Address>,
  });
  return { router, usdt: usdt.data, loading: contracts.isLoading || usdt.isLoading, error: contracts.error ?? usdt.error };
}

/** USDT balance and allowance to the router for a wallet, plus its BNB for network fees. */
export function useUsdtState(owner: Address | undefined) {
  const config = useWalletConfig();
  const { router, usdt } = usePaymentSetup();
  return useQuery({
    queryKey: ["usdt-state", usdt, router, owner],
    enabled: !!usdt && !!router && !!owner,
    queryFn: async () => {
      const [balance, allowance, native] = await Promise.all([
        readContract(config, { address: usdt!, abi: erc20Abi, functionName: "balanceOf", args: [owner!] }),
        readContract(config, { address: usdt!, abi: erc20Abi, functionName: "allowance", args: [owner!, router!] }),
        getBalance(config, { address: owner! }).then((b) => b.value),
      ]);
      return { balance, allowance, native };
    },
  });
}

export interface Eligibility {
  status: string;
  eligibleNow: boolean;
  expiresAt: string | null;
}

export function useEligibility() {
  const { me } = useSession();
  return useQuery({ queryKey: ["me", "eligibility", me?.wallet], enabled: !!me, queryFn: () => api.get<Eligibility>("/me/eligibility") });
}

export interface MySubscription {
  projectId: string;
  units: number;
  amount: string;
  status: string;
  offeringStatus: string;
  refundAvailable: boolean;
}

export function useMySubscriptions() {
  const { me } = useSession();
  return useQuery({
    queryKey: ["me", "subscriptions", me?.wallet],
    enabled: !!me,
    queryFn: () => api.get<{ items: MySubscription[] }>("/me/subscriptions"),
  });
}

/** The indexer confirms a block a few seconds after the wallet does; refresh API views a couple of times. */
export function useRefreshAfterTx() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries();
    for (const ms of [2500, 6000, 12000]) setTimeout(() => void qc.invalidateQueries(), ms);
  };
}
