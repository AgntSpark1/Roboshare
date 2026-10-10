// TEST-ONLY local demo: starts the stack and seeds two sample projects on anvil, then keeps running.
//   pnpm --filter @roboshare/e2e demo        (then start apps/web and apps/admin with e2e/src/accounts.ts appEnv)
import { auditRegistryAbi, offeringManagerAbi, revenueDistributorAbi, subscriptionRouterAbi } from "@roboshare/shared";
import { erc20Abi, maxUint256, type Abi, type Address } from "viem";
import { ROLES } from "./accounts.ts";
import { bytes32, ONE, scenario } from "./scenario.ts";
import { startStack } from "./stack.ts";

const { state, stop } = await startStack();
const s = scenario(state);
const A = state.addr;

async function buy(who: Address, pid: `0x${string}`, units: number, price: bigint) {
  await s.kyc(who);
  await s.mintUsdt(who, BigInt(units) * price + 5_000n * ONE);
  await s.send(who, { address: A.MockUSDT!, abi: erc20Abi as Abi, functionName: "approve", args: [A.SubscriptionRouter!, maxUint256] });
  await s.send(who, { address: A.SubscriptionRouter!, abi: subscriptionRouterAbi as Abi, functionName: "subscribe", args: [pid, units, BigInt(units) * price] });
}

// An ACTIVE project with one claimable distribution.
const price2 = 500n * ONE;
const p2 = await s.openOffering({ slug: "rs-002", title: "星港 02 号", unitPrice: price2, minUnits: 70, perWalletMax: 100, durationSec: 3 * 86_400 });
await buy(ROLES.alice, p2.pid, 12, price2);
await buy(ROLES.bob, p2.pid, 88, price2);
await s.send(ROLES.operator, { address: p2.offering, abi: offeringManagerAbi as Abi, functionName: "settle" });
await s.activate(p2.pid);
const amount = 880n * ONE;
await s.send(ROLES.operator, {
  address: A.AuditRegistry!,
  abi: auditRegistryAbi as Abi,
  functionName: "submitRecord",
  args: [{ projectId: p2.pid, kind: 1, contentHash: bytes32("demo-report-2026-09"), docType: bytes32("PNL_REPORT"), offchainRef: bytes32("demo"), periodStart: 1_756_684_800n, periodEnd: 1_759_276_800n, distributableAmount: amount, paymentToken: A.MockUSDT! }],
});
const recordId = (await s.pub.readContract({ address: A.AuditRegistry!, abi: auditRegistryAbi, functionName: "computeRecordId", args: [p2.pid, 1, bytes32("demo-report-2026-09")] })) as `0x${string}`;
await s.send(ROLES.reviewer, { address: A.AuditRegistry!, abi: auditRegistryAbi as Abi, functionName: "approve", args: [recordId] });
const distributor = await s.distributorOf(p2.pid);
await s.fundTreasury(distributor, amount);
const snap = (await s.pub.getBlockNumber()) - 1n;
const holders = [ROLES.alice, ROLES.bob].sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : 1));
await s.send(ROLES.operator, { address: distributor, abi: revenueDistributorAbi as Abi, functionName: "proposeBatch", args: [recordId, amount, snap, holders] });
await s.send(ROLES.reviewer, { address: distributor, abi: revenueDistributorAbi as Abi, functionName: "approveBatch", args: [1n] });

// An open offering.
const p1 = await s.openOffering({ slug: "rs-001", title: "星港 01 号", unitPrice: 520n * ONE, minUnits: 60, perWalletMax: 40, durationSec: 4 * 86_400 + 7 * 3600 });
await buy(ROLES.bob, p1.pid, 23, 520n * ONE);
await s.kyc(ROLES.alice);
await s.mintUsdt(ROLES.alice, 30_000n * ONE);
await s.indexed();

console.log(`demo stack ready (TEST-ONLY). RPC ${state.rpcUrl}. Ctrl-C to stop.`);
process.on("SIGINT", () => void stop().then(() => process.exit(0)));
process.on("SIGTERM", () => void stop().then(() => process.exit(0)));
await new Promise(() => undefined);
