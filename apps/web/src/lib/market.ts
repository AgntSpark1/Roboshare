"use client";
import { useQuery } from "@tanstack/react-query";
import { readContract } from "@wagmi/core";
import { erc20Abi, type Address } from "viem";
import { shareMarketAbi } from "@roboshare/shared";
import { api, contractOf, useWalletConfig } from "@roboshare/ui";
import { useContracts, usePaymentSetup } from "@/lib/data";

export interface MarketListing {
  id: bigint;
  projectId: string;
  seller: Address;
  units: number;
  /** Units a buyer can take now: capped by expiry and the seller's balance and allowance. */
  fillable: number;
  pricePerUnit: bigint;
  expiresAt: number;
}

export interface MarketTrade {
  projectId: string;
  listingId: string;
  buyer: Address;
  seller: Address;
  units: number;
  pricePerUnit: string;
  cost: string;
  at: string | null;
  chain: { txHash: string; blockNumber: string };
}

export interface MarketStat {
  projectId: string;
  lastPrice: string;
  lastAt: string | null;
  trades30d: number;
  units30d: number;
}

export type ListingSort = "price" | "newest";

/** The ShareMarket address, when one is deployed and indexed. */
export function useMarketAddress(): Address | undefined {
  return contractOf(useContracts().data, "SHARE_MARKET");
}

/** Buyable listings, newest first. Exported for tests. */
export function activeListings(items: MarketListing[]): MarketListing[] {
  return items.filter((l) => l.units > 0 && l.fillable > 0).sort((a, b) => (a.id < b.id ? 1 : -1));
}

/** Filters and sorts buyable listings for the market page. Exported for tests. */
export function browseListings(
  items: MarketListing[],
  opts: { projectId?: string; maxPrice?: bigint; sort: ListingSort; exclude?: Address },
): MarketListing[] {
  const out = activeListings(items).filter(
    (l) =>
      (!opts.projectId || l.projectId === opts.projectId.toLowerCase()) &&
      (opts.maxPrice === undefined || l.pricePerUnit <= opts.maxPrice) &&
      (!opts.exclude || l.seller.toLowerCase() !== opts.exclude.toLowerCase()),
  );
  if (opts.sort === "price") out.sort((a, b) => (a.pricePerUnit === b.pricePerUnit ? (a.id < b.id ? 1 : -1) : a.pricePerUnit < b.pricePerUnit ? -1 : 1));
  return out;
}

/** Price relative to a reference, in whole percent (positive = above). Exported for tests. */
export function premiumPct(price: bigint, ref: bigint | string | null | undefined): number | null {
  if (ref === null || ref === undefined) return null;
  const r = BigInt(ref);
  if (r === 0n) return null;
  return Number(((price - r) * 1000n) / r) / 10;
}

/**
 * Every live listing across all projects, read straight from the contract (the market is small
 * and this avoids indexer lag right after a seller lists).
 */
export function useAllListings() {
  const config = useWalletConfig();
  const market = useMarketAddress();
  return useQuery({
    queryKey: ["market", market],
    enabled: !!market,
    refetchInterval: 20_000,
    queryFn: async (): Promise<MarketListing[]> => {
      const next = (await readContract(config, { address: market!, abi: shareMarketAbi, functionName: "nextListingId" })) as bigint;
      // Bound the scan; older listings than this are almost certainly sold, cancelled or expired.
      const from = next > 300n ? next - 300n : 1n;
      const ids: bigint[] = [];
      for (let i = next - 1n; i >= from; i--) ids.push(i);
      const rows = await Promise.all(
        ids.map(async (id) => {
          const l = (await readContract(config, { address: market!, abi: shareMarketAbi, functionName: "getListing", args: [id] })) as {
            seller: Address;
            projectId: `0x${string}`;
            units: number;
            expiresAt: bigint;
            pricePerUnit: bigint;
          };
          if (l.units === 0) return null;
          const fillable = (await readContract(config, { address: market!, abi: shareMarketAbi, functionName: "fillable", args: [id] })) as number;
          return { id, projectId: l.projectId.toLowerCase(), seller: l.seller, units: l.units, fillable, pricePerUnit: l.pricePerUnit, expiresAt: Number(l.expiresAt) };
        }),
      );
      return rows.filter((r): r is MarketListing => r !== null);
    },
  });
}

/** Live listings for one project. */
export function useListings(projectId: string) {
  const all = useAllListings();
  const pid = projectId.toLowerCase();
  return { ...all, data: all.data?.filter((l) => l.projectId === pid) };
}

/** Completed trades (newest first) and each project's last price and 30-day activity, from the indexer. */
export function useMarketTrades(projectId?: string) {
  const market = useMarketAddress();
  return useQuery({
    queryKey: ["market-trades", market, projectId ?? "all"],
    enabled: !!market,
    refetchInterval: 30_000,
    queryFn: () => api.get<{ items: MarketTrade[]; stats: MarketStat[] }>(`/market/trades${projectId ? `?projectId=${projectId}` : ""}`),
  });
}

/** What a wallet needs to trade on the market: units held, token allowance, USDT balance and allowance. */
export function useMarketWallet(token: Address | null, owner: Address | undefined) {
  const config = useWalletConfig();
  const market = useMarketAddress();
  const { usdt } = usePaymentSetup();
  return useQuery({
    queryKey: ["market-wallet", market, token, usdt, owner],
    enabled: !!market && !!token && !!usdt && !!owner,
    queryFn: async () => {
      const [units, unitAllowance, usdtBalance, usdtAllowance] = await Promise.all([
        readContract(config, { address: token!, abi: erc20Abi, functionName: "balanceOf", args: [owner!] }),
        readContract(config, { address: token!, abi: erc20Abi, functionName: "allowance", args: [owner!, market!] }),
        readContract(config, { address: usdt!, abi: erc20Abi, functionName: "balanceOf", args: [owner!] }),
        readContract(config, { address: usdt!, abi: erc20Abi, functionName: "allowance", args: [owner!, market!] }),
      ]);
      return { units: Number(units), unitAllowance, usdtBalance, usdtAllowance };
    },
  });
}

/** USDT balance and allowance to the market, for buying from any project. */
export function useMarketUsdt(owner: Address | undefined) {
  const config = useWalletConfig();
  const market = useMarketAddress();
  const { usdt } = usePaymentSetup();
  return useQuery({
    queryKey: ["market-usdt", market, usdt, owner],
    enabled: !!market && !!usdt && !!owner,
    queryFn: async () => {
      const [balance, allowance] = await Promise.all([
        readContract(config, { address: usdt!, abi: erc20Abi, functionName: "balanceOf", args: [owner!] }),
        readContract(config, { address: usdt!, abi: erc20Abi, functionName: "allowance", args: [owner!, market!] }),
      ]);
      return { balance, allowance };
    },
  });
}
