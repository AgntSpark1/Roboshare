import type { PrismaClient } from "@roboshare/db";
import { createWalletClient, getAddress, http, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { offeringManagerAbi } from "@roboshare/shared";

/**
 * Settles offerings that are ready: sold out, or ended at or above the minimum. `settle()` needs no role,
 * so the sender is a gas-only wallet with no contract permissions (SETTLER_PRIVATE_KEY). A revert (e.g. a frozen subscriber that governance must exclude) is logged and left for people.
 */
export async function autoSettle(
  prisma: PrismaClient,
  pub: PublicClient,
  sendSettle: (offering: Address) => Promise<Hash>,
  now: Date = new Date(),
): Promise<{ settled: Address[]; failed: Address[] }> {
  const open = await prisma.offering.findMany({ where: { status: "OPEN" } });
  const ready = open.filter((o) => o.unitsSold >= o.minUnits && (o.unitsSold >= o.maxUnits || o.endAt <= now));
  const settled: Address[] = [];
  const failed: Address[] = [];
  for (const o of ready) {
    const address = getAddress(o.address);
    try {
      const done = await pub.readContract({ address, abi: offeringManagerAbi, functionName: "outcome" });
      if (Number(done) !== 0) continue; // already finalized on chain; the indexer will catch up
      const hash = await sendSettle(address);
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") {
        // Someone else's settle() can land first (settle is permissionless); that is not a failure.
        const after = await pub.readContract({ address, abi: offeringManagerAbi, functionName: "outcome" });
        if (Number(after) !== 0) continue;
        throw new Error(`settle reverted in ${hash}`);
      }
      settled.push(address);
      console.log(JSON.stringify({ msg: "auto-settled", offering: address, hash }));
    } catch (err) {
      failed.push(address);
      console.error(JSON.stringify({ msg: "auto-settle failed", offering: address, error: String(err).slice(0, 500) }));
    }
  }
  return { settled, failed };
}

/** Sends `settle()` from the gas-only key, simulating first so a revert never costs gas. */
export function settleSender(pub: PublicClient, rpcUrl: string, privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  return {
    account: account.address,
    send: async (offering: Address): Promise<Hash> => {
      const { request } = await pub.simulateContract({ account, address: offering, abi: offeringManagerAbi, functionName: "settle" });
      return wallet.writeContract({ ...request, chain: null });
    },
  };
}
