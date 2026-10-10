import type { PrismaClient } from "@roboshare/db";
import { revenueDistributorAbi, rwaShareTokenAbi } from "@roboshare/shared";
import type { Hex, PublicClient } from "viem";

export interface Issue {
  scope: string;
  subject: string;
  expected: string;
  actual: string;
  severity: "HIGH" | "MEDIUM";
}

/**
 * Compares the read models with contract state at the indexer cursor block. Any difference means
 * the indexer missed or misapplied an event; distributions must not be prepared until it is fixed.
 */
export async function reconcile(prisma: PrismaClient, client: PublicClient, chainId: number) {
  const cursor = await prisma.indexerCursor.findUnique({ where: { chainId } });
  if (!cursor) throw new Error("indexer has not run yet");
  const blockNumber = cursor.lastBlock;
  const issues: Issue[] = [];

  const projects = await prisma.project.findMany({ where: { tokenAddress: { not: null } } });
  for (const p of projects) {
    const token = p.tokenAddress as Hex;
    const holdings = await prisma.holding.findMany({ where: { projectIdOnchain: p.projectIdOnchain } });
    let dbSupply = 0;
    for (const h of holdings) {
      dbSupply += h.units;
      const onChain = await client.readContract({
        address: token, abi: rwaShareTokenAbi, functionName: "balanceOf", args: [h.wallet as Hex], blockNumber,
      });
      if (onChain !== BigInt(h.units)) {
        issues.push({ scope: "HOLDING", subject: `${p.projectIdOnchain}:${h.wallet}`, expected: onChain.toString(), actual: String(h.units), severity: "HIGH" });
      }
    }
    const supply = await client.readContract({ address: token, abi: rwaShareTokenAbi, functionName: "totalSupply", blockNumber });
    if (supply !== BigInt(dbSupply)) {
      issues.push({ scope: "SUPPLY", subject: p.projectIdOnchain, expected: supply.toString(), actual: String(dbSupply), severity: "HIGH" });
    }

    if (p.distributorAddress) {
      const unclaimed = await client.readContract({
        address: p.distributorAddress as Hex, abi: revenueDistributorAbi, functionName: "totalUnclaimed", blockNumber,
      });
      const rows = await prisma.distributionAllocation.findMany({
        where: { projectIdOnchain: p.projectIdOnchain, claimed: false, batch: { status: "CLAIMABLE" } },
        select: { net: true },
      });
      const dbUnclaimed = rows.reduce((s, r) => s + BigInt(r.net.toFixed()), 0n);
      if (unclaimed !== dbUnclaimed) {
        issues.push({ scope: "UNCLAIMED", subject: p.projectIdOnchain, expected: unclaimed.toString(), actual: dbUnclaimed.toString(), severity: "HIGH" });
      }
    }
  }

  const run = await prisma.reconciliationRun.create({
    data: { block: blockNumber, ok: issues.length === 0, issues: { create: issues } },
    include: { issues: true },
  });
  return run;
}
