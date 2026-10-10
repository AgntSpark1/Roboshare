"use client";
import { useQuery } from "@tanstack/react-query";
import { getBlock } from "@wagmi/core";
import { useWalletConfig } from "./wallet";

/**
 * "Now" as the contracts see it (latest block timestamp, ms). Offering windows are enforced on-chain, so the UI
 * compares against chain time rather than the browser clock. Falls back to the browser clock until the first read.
 */
export function useChainNow(): number {
  const config = useWalletConfig();
  const q = useQuery({
    queryKey: ["chain-now"],
    refetchInterval: 10_000,
    queryFn: async () => ({ chain: Number((await getBlock(config)).timestamp) * 1000, local: Date.now() }),
  });
  return q.data ? q.data.chain + (Date.now() - q.data.local) : Date.now();
}
