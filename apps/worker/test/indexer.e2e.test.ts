import { PrismaClient } from "@roboshare/db";
import {
  allocate,
  assetRegistryAbi,
  auditRegistryAbi,
  offeringManagerAbi,
  projectFactoryAbi,
  revenueDistributorAbi,
  rwaShareTokenAbi,
  subscriptionRouterAbi,
} from "@roboshare/shared";
import { erc20Abi, getAddress, keccak256, parseAbi, stringToHex, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Indexer } from "../src/indexer.js";
import { reconcile } from "../src/reconcile.js";
import { autoSettle, settleSender } from "../src/settler.js";
import { generatePrivateKey } from "viem/accounts";
import { asSafe, bytes32, resetDb, send, startAnvil, type Chain } from "./anvil.js";

const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const ONE = 10n ** 18n;
const UNIT_PRICE = 1_000n * ONE;
const PID = keccak256(stringToHex("e2e-project-1"));

let c: Chain;
let prisma: PrismaClient;
let indexer: Indexer;
let A: Record<string, Address>;
let token: Address;
let offering: Address;
let distributor: Address;

beforeAll(async () => {
  c = await startAnvil(18545);
  prisma = new PrismaClient();
  await resetDb(prisma);
  const [, , operator, reviewer, , agent, feeRecipient, alice, bob, treasury] = c.accounts;
  A = { operator: operator!, reviewer: reviewer!, agent: agent!, feeRecipient: feeRecipient!, alice: alice!, bob: bob!, treasury: treasury! };
  indexer = new Indexer(prisma, c.pub as any, {
    chainId: 31337,
    rpcUrl: c.rpcUrl,
    assetRegistry: c.addr.AssetRegistry!,
    auditRegistry: c.addr.AuditRegistry!,
    identityRegistry: c.addr.IdentityRegistry!,
    subscriptionRouter: c.addr.SubscriptionRouter!,
    projectFactory: c.addr.ProjectFactory!,
    startBlock: 0n,
    confirmations: 0,
    batchSize: 50,
  });
  await indexer.init();
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  c?.stop();
});

describe("indexer against a local chain", () => {
  it("indexes deployment roles", async () => {
    await indexer.catchUp();
    const op = await prisma.roleGrant.findMany({ where: { account: A.operator!.toLowerCase(), active: true } });
    expect(op.length).toBeGreaterThan(0);
  });

  it("follows a project from registration to an active, funded offering", async () => {
    await send(c, A.operator!, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "registerProject", args: [PID, bytes32("asset-1"), bytes32("issuer-1"), bytes32("rights-v1")] });
    await send(c, A.reviewer!, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "transition", args: [PID, 2, bytes32("kyb ok")] });
    await asSafe(c, async (tl) => {
      await send(c, tl, {
        address: c.addr.ProjectFactory!, abi: projectFactoryAbi, functionName: "deployProject",
        args: [{ projectId: PID, name: "RoboShare Vehicle 1", symbol: "RSV1", treasury: A.treasury }],
      });
    });
    const p = await c.pub.readContract({ address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "offeringOf", args: [PID] });
    offering = p as Address;
    const now = (await c.pub.getBlock()).timestamp;
    await asSafe(c, async (tl) => {
      await send(c, tl, {
        address: offering, abi: offeringManagerAbi, functionName: "configure",
        args: [{ unitPrice: UNIT_PRICE, minUnits: 100, maxUnits: 100, perWalletMax: 100, startTime: now, endTime: now + 86_400n, treasury: A.treasury, termsHash: bytes32("terms-v1") }],
      });
      await send(c, tl, { address: offering, abi: offeringManagerAbi, functionName: "open" });
    });
    const usdt = c.addr.MockUSDT!;
    for (const [who, units] of [[A.alice!, 60], [A.bob!, 40]] as const) {
      await send(c, who, { address: usdt, abi: mintAbi, functionName: "mint", args: [who, BigInt(units) * UNIT_PRICE] });
      await send(c, who, { address: usdt, abi: erc20Abi, functionName: "approve", args: [c.addr.SubscriptionRouter!, 2n ** 256n - 1n] });
      await send(c, who, { address: c.addr.SubscriptionRouter!, abi: subscriptionRouterAbi, functionName: "subscribe", args: [PID, units, BigInt(units) * UNIT_PRICE] });
    }
    // Sold out: the worker's gas-only settler (no role) settles it before the deadline.
    await indexer.catchUp();
    const settlerKey = generatePrivateKey();
    const settler = settleSender(c.pub as any, c.rpcUrl, settlerKey);
    await c.test.setBalance({ address: settler.account, value: 10n ** 18n });
    expect(await autoSettle(prisma, c.pub as any, settler.send)).toEqual({ settled: [getAddress(offering)], failed: [] });
    await asSafe(c, (tl) => send(c, tl, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "transition", args: [PID, 5, bytes32("go live")] }));
    token = ((await c.pub.readContract({ address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "getProject", args: [PID] })) as { token: Address }).token;
    await send(c, A.alice!, { address: token, abi: rwaShareTokenAbi, functionName: "transfer", args: [A.bob!, 10n] });

    await indexer.catchUp();
    const project = await prisma.project.findUniqueOrThrow({ where: { projectIdOnchain: PID }, include: { offering: true, holdings: true } });
    distributor = project.distributorAddress as Address;
    expect(project.state).toBe("ACTIVE");
    expect(project.fundedAtBlock).not.toBeNull();
    expect(project.offering?.status).toBe("SETTLED");
    expect(project.offering?.unitsSold).toBe(100);
    const units = Object.fromEntries(project.holdings.map((h) => [h.wallet, h.units]));
    expect(units).toEqual({ [A.alice!.toLowerCase()]: 50, [A.bob!.toLowerCase()]: 50 });
    const subs = await prisma.subscription.findMany({ where: { projectIdOnchain: PID } });
    expect(subs.map((s) => s.status)).toEqual(["SETTLED", "SETTLED"]);
    const states = await prisma.projectStateChange.findMany({ where: { projectIdOnchain: PID }, orderBy: { blockNumber: "asc" } });
    expect(states.map((s) => s.toState)).toEqual(["DRAFT", "VERIFIED", "OFFERING", "FUNDED", "ACTIVE"]);
  }, 60_000);

  it("indexes a distribution and matches the TypeScript allocation mirror", async () => {
    const amount = 10_007n * ONE + 3n; // odd amount to produce dust
    await send(c, A.operator!, {
      address: c.addr.AuditRegistry!, abi: auditRegistryAbi, functionName: "submitRecord",
      args: [{ projectId: PID, kind: 1, contentHash: bytes32("report-q3"), docType: bytes32("PNL_REPORT"), offchainRef: bytes32("key"), periodStart: 1n, periodEnd: 2n, distributableAmount: amount, paymentToken: c.addr.MockUSDT! }],
    });
    const recordId = (await c.pub.readContract({ address: c.addr.AuditRegistry!, abi: auditRegistryAbi, functionName: "computeRecordId", args: [PID, 1, bytes32("report-q3")] })) as Hex;
    await send(c, A.reviewer!, { address: c.addr.AuditRegistry!, abi: auditRegistryAbi, functionName: "approve", args: [recordId] });
    await send(c, A.treasury!, { address: c.addr.MockUSDT!, abi: mintAbi, functionName: "mint", args: [A.treasury!, amount] });
    await send(c, A.treasury!, { address: c.addr.MockUSDT!, abi: erc20Abi, functionName: "approve", args: [distributor, amount] });
    const snap = (await c.pub.getBlockNumber()) - 1n;
    const holders = [A.alice!, A.bob!].sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : 1));
    await send(c, A.operator!, { address: distributor, abi: revenueDistributorAbi, functionName: "proposeBatch", args: [recordId, amount, snap, holders] });
    await send(c, A.reviewer!, { address: distributor, abi: revenueDistributorAbi, functionName: "approveBatch", args: [1n] });
    await send(c, A.alice!, { address: distributor, abi: revenueDistributorAbi, functionName: "claim", args: [1n] });

    await indexer.catchUp();
    const record = await prisma.auditRecord.findUniqueOrThrow({ where: { recordIdOnchain: recordId } });
    expect(record.status).toBe("APPROVED");
    expect(record.distributableAmount.toFixed()).toBe(amount.toString());
    const batch = await prisma.distributionBatch.findUniqueOrThrow({
      where: { projectIdOnchain_batchIdOnchain: { projectIdOnchain: PID, batchIdOnchain: 1 } },
      include: { allocations: true },
    });
    expect(batch.status).toBe("CLAIMABLE");
    const mirror = allocate(amount, 0n, [{ address: "alice", units: 50 }, { address: "bob", units: 50 }]);
    expect(batch.totalNet.toFixed()).toBe(mirror.totalNet.toString());
    expect(batch.totalFee.toFixed()).toBe(mirror.totalFee.toString());
    expect(batch.dustOut.toFixed()).toBe(mirror.dustOut.toString());
    const alice = batch.allocations.find((a) => a.wallet === A.alice!.toLowerCase())!;
    expect(alice.claimed).toBe(true);
    expect(alice.net.toFixed()).toBe(mirror.allocations[0]!.net.toString());
  }, 60_000);

  it("reconciles cleanly and flags an injected mismatch", async () => {
    expect((await reconcile(prisma, c.pub as any, 31337)).ok).toBe(true);
    await prisma.holding.update({
      where: { projectIdOnchain_wallet: { projectIdOnchain: PID, wallet: A.bob!.toLowerCase() } },
      data: { units: 49 },
    });
    const run = await reconcile(prisma, c.pub as any, 31337);
    expect(run.ok).toBe(false);
    expect(run.issues.map((i) => i.scope).sort()).toEqual(["HOLDING", "SUPPLY"]);
    await prisma.holding.update({
      where: { projectIdOnchain_wallet: { projectIdOnchain: PID, wallet: A.bob!.toLowerCase() } },
      data: { units: 50 },
    });
  });

  it("rolls back events from blocks that were reorged out", async () => {
    const snapshot = await c.test.snapshot();
    await send(c, A.alice!, { address: token, abi: rwaShareTokenAbi, functionName: "transfer", args: [A.bob!, 5n] });
    await indexer.catchUp();
    const before = await prisma.holding.findUniqueOrThrow({ where: { projectIdOnchain_wallet: { projectIdOnchain: PID, wallet: A.alice!.toLowerCase() } } });
    expect(before.units).toBe(45);

    await c.test.revert({ id: snapshot });
    await c.test.mine({ blocks: 3 });
    const r = await indexer.tick();
    expect(r?.reorgedTo).toBeDefined();
    await indexer.catchUp();

    const after = await prisma.holding.findUniqueOrThrow({ where: { projectIdOnchain_wallet: { projectIdOnchain: PID, wallet: A.alice!.toLowerCase() } } });
    expect(after.units).toBe(50);
    // Projections rebuilt from the surviving events still match the chain.
    expect((await reconcile(prisma, c.pub as any, 31337)).ok).toBe(true);
    const batch = await prisma.distributionBatch.findFirstOrThrow({ where: { projectIdOnchain: PID } });
    expect(batch.status).toBe("CLAIMABLE");
  }, 60_000);
});
