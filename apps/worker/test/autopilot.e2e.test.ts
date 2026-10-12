import { PrismaClient } from "@roboshare/db";
import {
  assetRegistryAbi,
  auditRegistryAbi,
  offeringManagerAbi,
  projectFactoryAbi,
  revenueDistributorAbi,
  subscriptionRouterAbi,
} from "@roboshare/shared";
import { erc20Abi, keccak256, parseAbi, stringToHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Autopilot, dailyOperatingTotals, monthlyReport, previousMonth, type PeriodTotals } from "../src/autopilot.js";
import { Indexer } from "../src/indexer.js";
import { asSafe, bytes32, resetDb, send, startAnvil, type Chain } from "./anvil.js";

const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const ONE = 10n ** 18n;
const UNIT_PRICE = 100n * ONE;
const PID = keccak256(stringToHex("autopilot-project-1"));
const OPERATOR_ROLE = keccak256(stringToHex("OPERATOR_ROLE"));
const REVIEWER_ROLE = keccak256(stringToHex("REVIEWER_ROLE"));

describe("month boundaries", () => {
  it("takes the previous calendar month in Beijing time", () => {
    // 2026-11-30 17:00 UTC is already 1 December in Beijing.
    expect(previousMonth(new Date("2026-11-30T17:00:00Z"), 8)).toEqual({ start: "2026-11-01", end: "2026-12-01" });
    expect(previousMonth(new Date("2026-11-30T15:00:00Z"), 8)).toEqual({ start: "2026-10-01", end: "2026-11-01" });
    expect(previousMonth(new Date("2027-01-05T00:00:00Z"), 8)).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  });

  it("builds a valid report whose distributable amount is revenue minus expenses", () => {
    const r = monthlyReport(PID, "0x0000000000000000000000000000000000000001", "2026-10-01", "2026-11-01", 3_900n * ONE, 900n * ONE, 31);
    expect(r.distributableAmount).toBe((3_000n * ONE).toString());
    expect(r.expenses).toHaveLength(1);
  });
});

describe("monthly distribution autopilot on a local chain", () => {
  let c: Chain;
  let prisma: PrismaClient;
  let indexer: Indexer;
  let pilot: Autopilot;
  let distributor: Address;
  let treasury: Address;
  let usdt: Address;
  let now = new Date();
  const totals: { value: { revenue: bigint; expenses: bigint; days: number } | null } = { value: null };
  const submitterKey = generatePrivateKey();
  const approverKey = generatePrivateKey();
  const submitter = privateKeyToAccount(submitterKey).address;
  const approver = privateKeyToAccount(approverKey).address;

  /** Indexer and autopilot passes until nothing more happens. */
  async function settleDown() {
    const kinds: string[] = [];
    for (let i = 0; i < 8; i++) {
      await indexer.catchUp();
      const ev = await pilot.tick();
      kinds.push(...ev.map((e) => e.kind));
      if (ev.length === 0) break;
    }
    await indexer.catchUp();
    return kinds;
  }

  beforeAll(async () => {
    c = await startAnvil(18547);
    prisma = new PrismaClient();
    await resetDb(prisma);
    const [, , operator, reviewer, , , , alice, bob, t] = c.accounts;
    treasury = t!;
    usdt = c.addr.MockUSDT!;
    indexer = new Indexer(prisma, c.pub as any, {
      chainId: 31337, rpcUrl: c.rpcUrl, assetRegistry: c.addr.AssetRegistry!, auditRegistry: c.addr.AuditRegistry!,
      identityRegistry: c.addr.IdentityRegistry!, subscriptionRouter: c.addr.SubscriptionRouter!, projectFactory: c.addr.ProjectFactory!,
      startBlock: 0n, confirmations: 0, batchSize: 50,
    });
    await indexer.init();

    // A funded, active vehicle with two holders (same path as the indexer test).
    await send(c, operator!, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "registerProject", args: [PID, bytes32("asset-ap"), bytes32("issuer"), bytes32("rights")] });
    await send(c, reviewer!, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "transition", args: [PID, 2, bytes32("ok")] });
    await asSafe(c, (safe) => send(c, safe, {
      address: c.addr.ProjectFactory!, abi: projectFactoryAbi, functionName: "deployProject",
      args: [{ projectId: PID, name: "Autopilot Vehicle", symbol: "RSAP", treasury }],
    }));
    const offering = (await c.pub.readContract({ address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "offeringOf", args: [PID] })) as Address;
    const start = (await c.pub.getBlock()).timestamp;
    await asSafe(c, async (safe) => {
      await send(c, safe, { address: offering, abi: offeringManagerAbi, functionName: "configure", args: [{ unitPrice: UNIT_PRICE, minUnits: 100, maxUnits: 100, perWalletMax: 100, startTime: start, endTime: start + 86_400n, treasury, termsHash: bytes32("terms") }] });
      await send(c, safe, { address: offering, abi: offeringManagerAbi, functionName: "open" });
    });
    for (const [who, units] of [[alice!, 70], [bob!, 30]] as const) {
      await send(c, who, { address: usdt, abi: mintAbi, functionName: "mint", args: [who, BigInt(units) * UNIT_PRICE] });
      await send(c, who, { address: usdt, abi: erc20Abi, functionName: "approve", args: [c.addr.SubscriptionRouter!, 2n ** 256n - 1n] });
      await send(c, who, { address: c.addr.SubscriptionRouter!, abi: subscriptionRouterAbi, functionName: "subscribe", args: [PID, units, BigInt(units) * UNIT_PRICE] });
    }
    await send(c, operator!, { address: offering, abi: offeringManagerAbi, functionName: "settle" });
    await asSafe(c, (safe) => send(c, safe, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "transition", args: [PID, 5, bytes32("in service")] }));
    await indexer.catchUp();
    distributor = (await prisma.project.findUniqueOrThrow({ where: { projectIdOnchain: PID } })).distributorAddress as Address;

    // Governance grants the two automation wallets their minimal roles, and gas.
    await asSafe(c, async (safe) => {
      for (const target of [c.addr.AuditRegistry!, distributor]) {
        await send(c, safe, { address: target, abi: auditRegistryAbi, functionName: "grantRole", args: [OPERATOR_ROLE, submitter] });
        await send(c, safe, { address: target, abi: auditRegistryAbi, functionName: "grantRole", args: [REVIEWER_ROLE, approver] });
      }
    });
    for (const a of [submitter, approver]) await c.test.setBalance({ address: a, value: 10n * ONE });

    now = new Date(Date.now() + 40 * 86_400_000); // the vehicle has been running for over a month
    pilot = new Autopilot(prisma, c.pub as any, {
      chainId: 31337, rpcUrl: c.rpcUrl, auditRegistry: c.addr.AuditRegistry!, paymentToken: usdt,
      submitterKey, approverKey, maxBatch: 50_000n * ONE, utcOffsetHours: 8, reportDay: 1,
    }, (async () => totals.value) as PeriodTotals, () => now);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    c?.stop();
  });

  it("does nothing without operating data", async () => {
    expect(await pilot.tick()).toEqual([]);
    expect(await prisma.financialReport.count()).toBe(0);
  });

  it("anchors, approves and proposes last month's report, then waits for the treasury", async () => {
    totals.value = { revenue: 3_900n * ONE, expenses: 900n * ONE, days: 31 };
    const kinds = await settleDown();
    expect(kinds).toEqual(["REPORT_SUBMITTED", "REPORT_APPROVED", "BATCH_PROPOSED", "TREASURY_SHORT"]);
    const report = await prisma.financialReport.findFirstOrThrow({ include: { reviews: true } });
    expect(report.status).toBe("APPROVED");
    expect(report.distributableAmount.toFixed()).toBe((3_000n * ONE).toString());
    expect(report.submittedByWallet).toBe(submitter.toLowerCase());
    expect(report.reviews).toHaveLength(1);
    const batch = await prisma.distributionBatch.findFirstOrThrow();
    expect(batch.status).toBe("PROPOSED");
    // The shortfall is reported once, not every pass.
    expect(await pilot.tick()).toEqual([]);
  }, 120_000);

  it("approves the batch as soon as the treasury is funded, and investors can claim", async () => {
    await send(c, treasury, { address: usdt, abi: mintAbi, functionName: "mint", args: [treasury, 3_000n * ONE] });
    await send(c, treasury, { address: usdt, abi: erc20Abi, functionName: "approve", args: [distributor, 2n ** 256n - 1n] });
    expect(await settleDown()).toEqual(["BATCH_APPROVED"]);
    const batch = await prisma.distributionBatch.findFirstOrThrow();
    expect(batch.status).toBe("CLAIMABLE");
    expect(batch.approver?.toLowerCase()).toBe(approver.toLowerCase());
    const alice = c.accounts[7]!;
    const before = (await c.pub.readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [alice] })) as bigint;
    await send(c, alice, { address: distributor, abi: revenueDistributorAbi, functionName: "claim", args: [BigInt(batch.batchIdOnchain)] });
    const after = (await c.pub.readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [alice] })) as bigint;
    expect(after).toBeGreaterThan(before);
    // Nothing is sent twice for the same month.
    expect(await settleDown()).toEqual([]);
    expect(await prisma.automationEvent.count({ where: { kind: "BATCH_APPROVED" } })).toBe(1);
  }, 120_000);

  it("leaves a month above the cap to staff", async () => {
    now = new Date(now.getTime() + 31 * 86_400_000);
    totals.value = { revenue: 90_000n * ONE, expenses: 0n, days: 30 };
    const kinds = await settleDown();
    expect(kinds).toEqual(["REPORT_SUBMITTED", "REPORT_APPROVED", "OVER_CAP"]);
    const pending = (await c.pub.readContract({ address: distributor, abi: revenueDistributorAbi, functionName: "pendingBatchId" })) as bigint;
    expect(pending).toBe(0n);
  }, 120_000);

  it("sums a calendar month of daily operating entries", async () => {
    const sum = dailyOperatingTotals(prisma);
    await prisma.dailyOperating.createMany({
      data: [
        { projectIdOnchain: PID, day: new Date("2026-09-30"), revenue: "5", expenses: "1", enteredBy: "x" },
        { projectIdOnchain: PID, day: new Date("2026-10-01"), revenue: "100", expenses: "30", enteredBy: "x" },
        { projectIdOnchain: PID, day: new Date("2026-10-31"), revenue: "200", expenses: "20", enteredBy: "x" },
        { projectIdOnchain: PID, day: new Date("2026-11-01"), revenue: "7", expenses: "0", enteredBy: "x" },
      ],
    });
    expect(await sum(PID, "2026-10-01", "2026-11-01")).toEqual({ revenue: 300n, expenses: 50n, days: 2 });
    expect(await sum(PID, "2026-12-01", "2027-01-01")).toBeNull();
  });

  it("cannot act once governance revokes its role", async () => {
    await asSafe(c, (safe) => send(c, safe, { address: c.addr.AuditRegistry!, abi: auditRegistryAbi, functionName: "revokeRole", args: [OPERATOR_ROLE, submitter] }));
    now = new Date(now.getTime() + 31 * 86_400_000);
    totals.value = { revenue: 1_000n * ONE, expenses: 0n, days: 30 };
    const ev = await pilot.tick();
    expect(ev.map((e) => e.kind)).toEqual(["ERROR"]);
    expect(await prisma.financialReport.count({ where: { recordIdOnchain: { not: null } } })).toBe(2);
    expect((await c.pub.readContract({ address: c.addr.AuditRegistry!, abi: auditRegistryAbi, functionName: "hasRole", args: [OPERATOR_ROLE, submitter] })) as boolean).toBe(false);
  }, 60_000);
});
