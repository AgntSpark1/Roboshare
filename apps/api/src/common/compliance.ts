import type { PrismaClient } from "@roboshare/db";

/**
 * Whether the IdentityRegistry enforces eligibility (KYC) checks, from its latest indexed ChecksRequiredSet event.
 * Off until governance switches it on (Charlene, 2026-10-11: no KYC for now); frozen wallets are blocked either way.
 */
export async function eligibilityChecksRequired(prisma: PrismaClient, chainId: number): Promise<boolean> {
  const last = await prisma.chainEvent.findFirst({
    where: { chainId, name: "ChecksRequiredSet" },
    orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
  });
  return (last?.args as { required?: boolean } | undefined)?.required === true;
}
