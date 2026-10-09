import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@roboshare/db";
import { allocate, auditRegistryAbi, reportHash, revenueDistributorAbi, financialReportSchema } from "@roboshare/shared";
import { createHmac, randomBytes } from "node:crypto";
import request from "supertest";
import { decodeFunctionData, keccak256, stringToHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import type { AppConfig } from "../src/config.js";

const DB = process.env.DATABASE_URL ?? "";
const ONE = 10n ** 18n;
const PID = keccak256(stringToHex("api-project-1"));
const RECORD = keccak256(stringToHex("record-1"));
const ADDR = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const DISTRIBUTOR = ADDR(0xd157);
const AUDIT_REGISTRY = ADDR(0xa0d1);
const USDT = ADDR(0x05d7);
const OPERATOR_ROLE = keccak256(stringToHex("OPERATOR_ROLE"));
const REVIEWER_ROLE = keccak256(stringToHex("REVIEWER_ROLE"));

const cfg: AppConfig = {
  nodeEnv: "test",
  port: 0,
  databaseUrl: DB,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  chainId: 31337,
  sessionSecret: randomBytes(32).toString("hex"),
  siweDomain: "app.roboshare.test",
  kycWebhookSecret: randomBytes(32).toString("hex"),
  assetRegistry: ADDR(0xa55e),
  auditRegistry: AUDIT_REGISTRY,
  paymentToken: USDT,
};

let app: INestApplication;
let prisma: PrismaClient;
const investor = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const operator = privateKeyToAccount(generatePrivateKey());
const reviewer = privateKeyToAccount(generatePrivateKey());
const cookies: Record<string, string> = {};
const http = () => request(app.getHttpServer());

async function login(acct: PrivateKeyAccount, overrides: { domain?: string; chainId?: number } = {}) {
  const n = await http().get(`/api/v1/auth/nonce?address=${acct.address}`).expect(200);
  const message = createSiweMessage({
    address: acct.address,
    chainId: overrides.chainId ?? cfg.chainId,
    domain: overrides.domain ?? cfg.siweDomain,
    nonce: n.body.nonce,
    uri: `https://${cfg.siweDomain}`,
    version: "1",
  });
  const signature = await acct.signMessage({ message });
  return http().post("/api/v1/auth/verify").send({ message, signature });
}

async function resetDb() {
  if (!/_(test|ci)(\?|$)/.test(DB)) throw new Error(`refusing to truncate non-test database ${DB}`);
  const rows = await prisma.$queryRaw<{ s: string; t: string }[]>`
    SELECT table_schema AS s, table_name AS t FROM information_schema.tables
    WHERE table_schema IN ('app','chain','compliance') AND table_type = 'BASE TABLE'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.s}"."${r.t}"`).join(", ")} CASCADE`);
}

async function seed() {
  const inv = investor.address.toLowerCase();
  const oth = other.address.toLowerCase();
  const zero = ADDR(0);
  await prisma.project.create({
    data: {
      projectIdOnchain: PID, assetIdOnchain: keccak256(stringToHex("asset")), issuerId: keccak256(stringToHex("issuer")),
      rightsDocHash: keccak256(stringToHex("rights")), registrant: operator.address.toLowerCase(), state: "ACTIVE",
      tokenAddress: ADDR(0x70c), offeringAddress: ADDR(0x0ff), distributorAddress: DISTRIBUTOR.toLowerCase(),
      fundedAtBlock: 10n, registeredBlock: 5n,
    },
  });
  await prisma.projectMeta.create({ data: { projectIdOnchain: PID, slug: "robotaxi-001", title: "Robotaxi 001", make: "TEST-ONLY", model: "Sample" } });
  await prisma.offering.create({
    data: {
      projectIdOnchain: PID, address: ADDR(0x0ff), status: "SETTLED", unitPrice: (1_000n * ONE).toString(), minUnits: 100, maxUnits: 100,
      perWalletMax: 100, startAt: new Date(0), endAt: new Date(1), treasury: ADDR(0x7e).toLowerCase(), termsHash: keccak256(stringToHex("terms")), unitsSold: 100,
    },
  });
  await prisma.subscription.createMany({
    data: [
      { projectIdOnchain: PID, wallet: inv, units: 60, amount: (60_000n * ONE).toString(), status: "SETTLED", lastTxHash: "0x01" },
      { projectIdOnchain: PID, wallet: oth, units: 40, amount: (40_000n * ONE).toString(), status: "SETTLED", lastTxHash: "0x02" },
    ],
  });
  const ev = () => crypto.randomUUID();
  await prisma.tokenTransfer.createMany({
    data: [
      { projectIdOnchain: PID, fromAddress: zero, toAddress: inv, units: 60, kind: "MINT", blockNumber: 10n, logIndex: 1, txHash: "0x10", eventId: ev() },
      { projectIdOnchain: PID, fromAddress: zero, toAddress: oth, units: 40, kind: "MINT", blockNumber: 10n, logIndex: 2, txHash: "0x10", eventId: ev() },
      { projectIdOnchain: PID, fromAddress: inv, toAddress: oth, units: 10, kind: "TRANSFER", blockNumber: 20n, logIndex: 0, txHash: "0x20", eventId: ev() },
    ],
  });
  await prisma.holding.createMany({
    data: [
      { projectIdOnchain: PID, wallet: inv, units: 50, lastBlock: 20n },
      { projectIdOnchain: PID, wallet: oth, units: 50, lastBlock: 20n },
    ],
  });
  await prisma.indexerCursor.create({ data: { chainId: 31337, lastBlock: 30n, lastHash: "0xabc" } });
  await prisma.auditRecord.create({
    data: {
      recordIdOnchain: RECORD, projectIdOnchain: PID, kind: "FINANCIAL_REPORT", status: "APPROVED", contentHash: keccak256(stringToHex("c")),
      docType: "0x00", version: 1, periodStart: 1n, periodEnd: 2n, distributableAmount: (10_000n * ONE).toString(), paymentToken: USDT.toLowerCase(),
      submitter: operator.address.toLowerCase(), reviewer: reviewer.address.toLowerCase(), submittedBlock: 25n,
    },
  });
  await prisma.roleGrant.createMany({
    data: [
      { chainId: 31337, contract: ADDR(1), role: OPERATOR_ROLE, account: operator.address.toLowerCase(), active: true, eventId: ev() },
      { chainId: 31337, contract: ADDR(1), role: REVIEWER_ROLE, account: reviewer.address.toLowerCase(), active: true, eventId: ev() },
      // The operator also holds REVIEWER on-chain, so only the two-person rule can stop self-review.
      { chainId: 31337, contract: ADDR(1), role: REVIEWER_ROLE, account: operator.address.toLowerCase(), active: true, eventId: ev() },
    ],
  });
}

const report = {
  projectId: PID,
  periodStart: "2026-07-01",
  periodEnd: "2026-10-01",
  paymentToken: USDT,
  revenue: [{ category: "RIDES", description: "fares", amount: (15_000n * ONE).toString() }],
  expenses: [{ category: "CHARGING", description: "", amount: (3_000n * ONE).toString() }],
  reserves: [{ kind: "MAINTENANCE", amount: (2_000n * ONE).toString(), rationale: "tyres" }],
  distributableAmount: (10_000n * ONE).toString(),
};

beforeAll(async () => {
  prisma = new PrismaClient();
  await resetDb();
  await seed();
  app = await createApp(cfg);
  await app.init();
  for (const [name, acct] of Object.entries({ investor, operator, reviewer })) {
    const res = await login(acct);
    expect(res.status).toBe(200);
    cookies[name] = res.headers["set-cookie"]![0]!.split(";")[0]!;
  }
  const userOf = async (a: PrivateKeyAccount) => (await prisma.wallet.findUniqueOrThrow({ where: { address: a.address.toLowerCase() } })).userId;
  await prisma.staffAccount.create({ data: { userId: await userOf(operator), roles: ["OPERATOR", "REVIEWER"] } });
  await prisma.staffAccount.create({ data: { userId: await userOf(reviewer), roles: ["REVIEWER"] } });
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

describe("public", () => {
  it("reports health", async () => {
    const r = await http().get("/api/v1/health").expect(200);
    expect(r.body).toMatchObject({ status: "ok", indexer: { lastBlock: "30" } });
  });

  it("lists projects with issued supply", async () => {
    const r = await http().get("/api/v1/projects").expect(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ id: PID, title: "Robotaxi 001", state: "ACTIVE", issuedUnits: 100, authorizedUnits: 100 });
    expect(r.body.items[0].offering.unitPrice).toBe((1_000n * ONE).toString());
  });

  it("returns 404 in the documented error shape", async () => {
    const r = await http().get(`/api/v1/projects/0x${"00".repeat(32)}`).expect(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });

  it("lists approved financials as ACTUAL figures", async () => {
    const r = await http().get(`/api/v1/projects/${PID}/financials`).expect(200);
    expect(r.body.items[0]).toMatchObject({ figureKind: "ACTUAL", distributableAmount: (10_000n * ONE).toString() });
  });
});

describe("aave (read-only)", () => {
  it("returns 503 until a verified read exists, then the latest snapshot", async () => {
    const none = await http().get("/api/v1/aave/markets").expect(503);
    expect(none.body.error.code).toBe("CHAIN_UNAVAILABLE");
    await prisma.aaveMarketSnapshot.create({
      data: {
        chainId: 56, blockNumber: 100n, blockHash: "0xaa", blockTime: new Date(), source: "test",
        addresses: { pool: ADDR(1) }, reserves: [{ symbol: "USDT", supplyAprBps: 500 }],
      },
    });
    const r = await http().get("/api/v1/aave/markets").expect(200);
    expect(r.body).toMatchObject({ chainId: 56, blockNumber: "100", readOnly: true, stale: false, reserves: [{ symbol: "USDT", supplyAprBps: 500 }] });
  });
});

describe("auth", () => {
  it("rejects investor routes without a session", async () => {
    const r = await http().get("/api/v1/me/portfolio").expect(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a SIWE message for another domain or chain", async () => {
    expect((await login(other, { domain: "evil.example" })).status).toBe(401);
    expect((await login(other, { chainId: 1 })).status).toBe(401);
  });

  it("does not accept a nonce twice", async () => {
    const n = await http().get(`/api/v1/auth/nonce?address=${other.address}`).expect(200);
    const message = createSiweMessage({ address: other.address, chainId: cfg.chainId, domain: cfg.siweDomain, nonce: n.body.nonce, uri: `https://${cfg.siweDomain}`, version: "1" });
    const signature = await other.signMessage({ message });
    await http().post("/api/v1/auth/verify").send({ message, signature }).expect(200);
    await http().post("/api/v1/auth/verify").send({ message, signature }).expect(401);
  });

  it("rejects a signature from a different wallet", async () => {
    const n = await http().get(`/api/v1/auth/nonce?address=${other.address}`).expect(200);
    const message = createSiweMessage({ address: other.address, chainId: cfg.chainId, domain: cfg.siweDomain, nonce: n.body.nonce, uri: `https://${cfg.siweDomain}`, version: "1" });
    const signature = await investor.signMessage({ message });
    await http().post("/api/v1/auth/verify").send({ message, signature }).expect(401);
  });
});

describe("investor", () => {
  it("shows the portfolio of the signed-in wallet only", async () => {
    const r = await http().get("/api/v1/me/portfolio").set("Cookie", cookies.investor!).expect(200);
    expect(r.body.items).toEqual([
      { projectId: PID, units: 50, issuedUnits: 100, shareBps: 5000, costBasis: (60_000n * ONE).toString() },
    ]);
  });
});

describe("admin", () => {
  it("rejects non-staff wallets", async () => {
    const r = await http().get("/api/v1/admin/roles").set("Cookie", cookies.investor!).expect(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });

  it("requires the on-chain role as well as the staff role", async () => {
    // reviewer has the REVIEWER staff role and on-chain grant, but not OPERATOR.
    await http().post("/api/v1/admin/reports").set("Cookie", cookies.reviewer!).send(report).expect(403);
  });

  let reportId: string;
  it("validates and stores a report, returning the anchoring transaction", async () => {
    const bad = await http().post("/api/v1/admin/reports").set("Cookie", cookies.operator!).send({ ...report, distributableAmount: "1" }).expect(400);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");

    const r = await http().post("/api/v1/admin/reports").set("Cookie", cookies.operator!).send(report).expect(201);
    reportId = r.body.id;
    expect(r.body.canonicalHash).toBe(reportHash(financialReportSchema.parse(report)));
    expect(r.body.tx.to).toBe(AUDIT_REGISTRY);
    const call = decodeFunctionData({ abi: auditRegistryAbi, data: r.body.tx.data });
    expect(call.functionName).toBe("submitRecord");
    expect((call.args![0] as any).distributableAmount).toBe(10_000n * ONE);

    await http().post("/api/v1/admin/reports").set("Cookie", cookies.operator!).send(report).expect(409);
  });

  it("forbids self-review and requires on-chain anchoring", async () => {
    const self = await http().post(`/api/v1/admin/reports/${reportId}/review`).set("Cookie", cookies.operator!).send({ decision: "APPROVE" }).expect(403);
    expect(self.body.error.code).toBe("SELF_REVIEW_FORBIDDEN");
    const early = await http().post(`/api/v1/admin/reports/${reportId}/review`).set("Cookie", cookies.reviewer!).send({ decision: "APPROVE" }).expect(409);
    expect(early.body.error.code).toBe("REPORT_NOT_ANCHORED");

    await prisma.financialReport.update({ where: { id: reportId }, data: { recordIdOnchain: keccak256(stringToHex("anchored")) } });
    const ok = await http().post(`/api/v1/admin/reports/${reportId}/review`).set("Cookie", cookies.reviewer!).send({ decision: "APPROVE" }).expect(200);
    expect(decodeFunctionData({ abi: auditRegistryAbi, data: ok.body.tx.data }).functionName).toBe("approve");
  });

  it("previews allocations from balances at the snapshot block", async () => {
    const amount = 10_000n * ONE;
    const before = await http().post("/api/v1/admin/distributions/preview").set("Cookie", cookies.operator!)
      .send({ projectId: PID, reportRecordId: RECORD, amount: amount.toString(), snapshotBlock: "15" }).expect(200);
    const sorted = [investor, other].map((a) => a.address.toLowerCase()).sort();
    const units15 = Object.fromEntries([[investor.address.toLowerCase(), 60], [other.address.toLowerCase(), 40]]);
    const mirror = allocate(amount, 0n, sorted.map((address) => ({ address, units: units15[address]! })));
    expect(before.body.totalNet).toBe(mirror.totalNet.toString());
    expect(before.body.holders.map((h: any) => h.address)).toEqual(sorted);

    const after = await http().post("/api/v1/admin/distributions/preview").set("Cookie", cookies.operator!)
      .send({ projectId: PID, reportRecordId: RECORD, amount: amount.toString(), snapshotBlock: "25" }).expect(200);
    expect(after.body.holders.map((h: any) => h.units)).toEqual([50, 50]);
  });

  it("refuses amounts above the report, bad snapshots and unreconciled state", async () => {
    const base = { projectId: PID, reportRecordId: RECORD, amount: (10_001n * ONE).toString(), snapshotBlock: "25" };
    const over = await http().post("/api/v1/admin/distributions/preview").set("Cookie", cookies.operator!).send(base).expect(409);
    expect(over.body.error.code).toBe("AMOUNT_EXCEEDS_REPORT");
    const future = await http().post("/api/v1/admin/distributions/preview").set("Cookie", cookies.operator!).send({ ...base, amount: "1", snapshotBlock: "31" }).expect(409);
    expect(future.body.error.code).toBe("SNAPSHOT_OUT_OF_RANGE");

    const run = await prisma.reconciliationRun.create({ data: { block: 30n, ok: false } });
    const blocked = await http().post("/api/v1/admin/distributions/preview").set("Cookie", cookies.operator!).send({ ...base, amount: "1" }).expect(409);
    expect(blocked.body.error.code).toBe("RECONCILIATION_BLOCKED");
    await prisma.reconciliationRun.delete({ where: { id: run.id } });
  });

  it("prepares proposeBatch with holders sorted ascending", async () => {
    const r = await http().post("/api/v1/admin/distributions").set("Cookie", cookies.operator!)
      .send({ projectId: PID, reportRecordId: RECORD, amount: (10_000n * ONE).toString(), snapshotBlock: "25" }).expect(201);
    expect(r.body.tx.to.toLowerCase()).toBe(DISTRIBUTOR.toLowerCase());
    const call = decodeFunctionData({ abi: revenueDistributorAbi, data: r.body.tx.data });
    expect(call.functionName).toBe("proposeBatch");
    const holders = (call.args![3] as string[]).map((h) => h.toLowerCase());
    expect(holders).toEqual([...holders].sort());
  });

  it("records every admin mutation in the audit log", async () => {
    const r = await http().get("/api/v1/admin/audit-log").set("Cookie", cookies.reviewer!).expect(200);
    const actions = r.body.items.map((i: any) => i.action);
    expect(actions).toEqual(expect.arrayContaining(["REPORT_SUBMIT", "REPORT_APPROVE", "DISTRIBUTION_PREPARE"]));
  });
});

describe("KYC webhook (TEST-ONLY mock provider)", () => {
  const sign = (ts: string, body: string, secret = cfg.kycWebhookSecret!) =>
    createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  const body = JSON.stringify({ eventId: `evt-${randomBytes(8).toString("hex")}`, caseRef: "case-1", wallet: investor.address, status: "APPROVED" });

  it("accepts a signed event once", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const post = () => http().post("/api/v1/webhooks/kyc/mock").set("Content-Type", "application/json").set("x-timestamp", ts).set("x-signature", sign(ts, body)).send(body);
    await post().expect(202);
    await post().expect(409);
    const c = await prisma.complianceCase.findFirstOrThrow({ where: { providerRef: "case-1" } });
    expect(c.status).toBe("APPROVED");
  });

  it("rejects bad signatures, stale timestamps and unknown providers", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    await http().post("/api/v1/webhooks/kyc/mock").set("Content-Type", "application/json").set("x-timestamp", ts).set("x-signature", sign(ts, body, "x".repeat(64))).send(body).expect(401);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    await http().post("/api/v1/webhooks/kyc/mock").set("Content-Type", "application/json").set("x-timestamp", old).set("x-signature", sign(old, body)).send(body).expect(401);
    await http().post("/api/v1/webhooks/kyc/acme").set("Content-Type", "application/json").send(body).expect(404);
  });
});
