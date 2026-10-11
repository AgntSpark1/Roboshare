"use client";
import { useQuery } from "@tanstack/react-query";
import { readContract } from "@wagmi/core";
import { erc20Abi, type Address } from "viem";
import { shareMarketAbi } from "@roboshare/shared";
import { contractOf, useWalletConfig } from "@roboshare/ui";
import { useContracts, usePaymentSetup } from "@/lib/data";

export interface MarketListing {
  id: bigint;
  seller: Address;
  units: number;
  /** Units a buyer can take now: capped by expiry and the seller's balance and allowance. */
  fillable: number;
  pricePerUnit: bigint;
  expiresAt: number;
}

/** The ShareMarket address, when one is deployed and indexed. */
export function useMarketAddress(): Address | undefined {
  return contractOf(useContracts().data, "SHARE_MARKET");
}

/** Newest first, so the latest offers show at the top. Exported for tests. */
export function activeListings(items: MarketListing[]): MarketListing[] {
  return items.filter((l) => l.units > 0 && l.fillable > 0).sort((a, b) => (a.id < b.id ? 1 : -1));
}

/** Listings are read straight from the contract; the market is small and this avoids a second source of truth. */
export function useListings(projectId: string) {
  const config = useWalletConfig();
  const market = useMarketAddress();
  return useQuery({
    queryKey: ["market", market, projectId],
    enabled: !!market,
    refetchInterval: 20_000,
    queryFn: async () => {
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
          if (l.projectId.toLowerCase() !== projectId.toLowerCase() || l.units === 0) return null;
          const fillable = (await readContract(config, { address: market!, abi: shareMarketAbi, functionName: "fillable", args: [id] })) as number;
          return { id, seller: l.seller, units: l.units, fillable, pricePerUnit: l.pricePerUnit, expiresAt: Number(l.expiresAt) };
        }),
      );
      return rows.filter((r): r is MarketListing => r !== null);
    },
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
