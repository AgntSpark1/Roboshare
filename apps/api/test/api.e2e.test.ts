import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@roboshare/db";
import { allocate, auditRegistryAbi, financialReportSchema, offeringManagerAbi, referralRewardsAbi, REFERRAL_LEVEL2_SHARE_BPS, reportHash, revenueDistributorAbi, subscriptionRouterAbi, verifyReferralProof } from "@roboshare/shared";
import { createHmac, randomBytes } from "node:crypto";
import request from "supertest";
import { decodeFunctionData, getAddress, keccak256, stringToHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { base32Decode, encryptSecret, hotp, newTotpSecret, TOTP_STEP_SECONDS } from "../src/common/totp.js";
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
  siweDomain: "app.roboshare.test, admin.roboshare.test",
  kycWebhookSecret: randomBytes(32).toString("hex"),
  assetRegistry: ADDR(0xa55e),
  auditRegistry: AUDIT_REGISTRY,
  paymentToken: USDT,
  totpEncKey: randomBytes(32).toString("hex"),
  rateLimitPerMinute: 100_000,
  safe: ADDR(0x5af),
};
const SAFE = ADDR(0x5af);
const MULTISEND = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
const totpSecrets: Record<string, string> = {};
const usedSteps: Record<string, Set<number>> = {};
/** A valid code from a time step (now ±1) this user has not used yet, so the replay guard never trips. */
function nextCode(who: string) {
  const now = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  const used = (usedSteps[who] ??= new Set());
  const step = [now, now - 1, now + 1].find((c) => !used.has(c));
  if (step === undefined) throw new Error("no unused TOTP step left for this test");
  used.add(step);
  return hotp(base32Decode(totpSecrets[who]!), BigInt(step));
}

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
    domain: overrides.domain ?? "app.roboshare.test",
    nonce: n.body.nonce,
    uri: `https://${overrides.domain ?? "app.roboshare.test"}`,
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
  for (const [name, acct, roles] of [["operator", operator, ["OPERATOR", "REVIEWER"]], ["reviewer", reviewer, ["REVIEWER", "GOV_VIEW"]]] as const) {
    totpSecrets[name] = newTotpSecret();
    await prisma.staffAccount.create({ data: { userId: await userOf(acct), roles: [...roles], totpSecretEnc: encryptSecret(totpSecrets[name]!, cfg.totpEncKey!) } });
  }
  // Staff routes need a fresh TOTP step-up; the "step-up" tests below check the refusal paths.
  for (const name of ["operator", "reviewer"]) {
    const r = await http().post("/api/v1/auth/staff/totp").set("Cookie", cookies[name]!).send({ code: nextCode(name) });
    expect(r.status).toBe(200);
    cookies[`${name}Plain`] = cookies[name]!;
    cookies[name] = r.headers["set-cookie"]![0]!.split(";")[0]!;
  }
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

  it("accepts every configured SIWE domain and advertises the first", async () => {
    const n = await http().get(`/api/v1/auth/nonce?address=${other.address}`).expect(200);
    expect(n.body.domain).toBe("app.roboshare.test");
    expect((await login(other, { domain: "admin.roboshare.test" })).status).toBe(200);
  });

  it("rejects a SIWE message for another domain or chain", async () => {
    expect((await login(other, { domain: "evil.example" })).status).toBe(401);
    expect((await login(other, { chainId: 1 })).status).toBe(401);
  });

  it("does not accept a nonce twice", async () => {
    const n = await http().get(`/api/v1/auth/nonce?address=${other.address}`).expect(200);
    const message = createSiweMessage({ address: other.address, chainId: cfg.chainId, domain: "app.roboshare.test", nonce: n.body.nonce, uri: "https://app.roboshare.test", version: "1" });
    const signature = await other.signMessage({ message });
    await http().post("/api/v1/auth/verify").send({ message, signature }).expect(200);
    await http().post("/api/v1/auth/verify").send({ message, signature }).expect(401);
  });

  it("rejects a signature from a different wallet", async () => {
    const n = await http().get(`/api/v1/auth/nonce?address=${other.address}`).expect(200);
    const message = createSiweMessage({ address: other.address, chainId: cfg.chainId, domain: "app.roboshare.test", nonce: n.body.nonce, uri: "https://app.roboshare.test", version: "1" });
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

  it("tells the console which roles the signed-in staff wallet holds", async () => {
    const r = await http().get("/api/v1/admin/me").set("Cookie", cookies.reviewer!).expect(200);
    expect(r.body).toMatchObject({ wallet: reviewer.address, roles: ["REVIEWER", "GOV_VIEW"] });
    expect(Date.parse(r.body.stepUpUntil)).toBeGreaterThan(Date.now());
    expect((await http().get("/api/v1/admin/me").set("Cookie", cookies.reviewerPlain!).expect(401)).body.error.code).toBe("STEP_UP_REQUIRED");
  });

  it("lists reports by status for reviewers", async () => {
    const r = await http().get("/api/v1/admin/reports?status=SUBMITTED").set("Cookie", cookies.reviewer!).expect(200);
    const mine = r.body.items.find((i: { id: string }) => i.id === reportId);
    expect(mine).toMatchObject({ status: "SUBMITTED", figureKind: "UNAUDITED", recordIdOnchain: null });
    expect(mine.body).toBeUndefined();
    await http().get("/api/v1/admin/reports?status=BOGUS").set("Cookie", cookies.reviewer!).expect(400);
    await http().get("/api/v1/admin/reports").set("Cookie", cookies.investor!).expect(403);
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

describe("staff step-up (TOTP)", () => {
  it("requires a recent authenticator code for admin routes", async () => {
    const r = await http().get("/api/v1/admin/roles").set("Cookie", cookies.operatorPlain!).expect(401);
    expect(r.body.error.code).toBe("STEP_UP_REQUIRED");
  });

  it("rejects wrong and reused codes", async () => {
    await http().post("/api/v1/auth/staff/totp").set("Cookie", cookies.operatorPlain!).send({ code: "000000" }).expect(401);
    const code = nextCode("operator");
    await http().post("/api/v1/auth/staff/totp").set("Cookie", cookies.operatorPlain!).send({ code }).expect(200);
    await http().post("/api/v1/auth/staff/totp").set("Cookie", cookies.operatorPlain!).send({ code }).expect(401);
  });

  it("refuses investors without an enrolled authenticator", async () => {
    await http().post("/api/v1/auth/staff/totp").set("Cookie", cookies.investor!).send({ code: "123456" }).expect(403);
  });
});

describe("idempotency", () => {
  it("replays the first response for a repeated Idempotency-Key", async () => {
    const body = { projectId: PID, reportRecordId: RECORD, amount: (1n * ONE).toString(), snapshotBlock: "25" };
    const key = `idem-${randomBytes(6).toString("hex")}`;
    const before = await prisma.adminAction.count({ where: { action: "DISTRIBUTION_PREPARE" } });
    const a = await http().post("/api/v1/admin/distributions").set("Cookie", cookies.operator!).set("Idempotency-Key", key).send(body).expect(201);
    const b = await http().post("/api/v1/admin/distributions").set("Cookie", cookies.operator!).set("Idempotency-Key", key).send(body).expect(201);
    expect(b.headers["idempotent-replay"]).toBe("true");
    expect(b.body).toEqual(a.body);
    expect(await prisma.adminAction.count({ where: { action: "DISTRIBUTION_PREPARE" } })).toBe(before + 1);
  });
});

describe("governance prepares (Safe, no timelock, never signed by the server)", () => {
  const PID2 = keccak256(stringToHex("api-project-2"));
  const OFFERING2 = ADDR(0x0ff2);
  const late = privateKeyToAccount(generatePrivateKey());

  beforeAll(async () => {
    await prisma.project.create({
      data: {
        projectIdOnchain: PID2, assetIdOnchain: keccak256(stringToHex("asset-2")), issuerId: keccak256(stringToHex("issuer")),
        rightsDocHash: keccak256(stringToHex("rights")), registrant: operator.address.toLowerCase(), state: "VERIFIED",
        tokenAddress: ADDR(0x70c2), offeringAddress: OFFERING2.toLowerCase(), distributorAddress: ADDR(0xd152).toLowerCase(), registeredBlock: 6n,
      },
    });
  });

  it("wraps offering configure+open in one Safe batch that takes effect when executed", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = { unitPrice: (1_000n * ONE).toString(), minUnits: 60, perWalletMax: 100, startTime: now, endTime: now + 30 * 86_400, treasury: ADDR(0x7e), termsHash: keccak256(stringToHex("terms")) };
    const r = await http().post(`/api/v1/admin/projects/${PID2}/offering`).set("Cookie", cookies.reviewer!).send(body).expect(201);
    const p = r.body.proposal;
    expect(p.safe).toBe(SAFE);
    expect(p.tx).toMatchObject({ to: MULTISEND, operation: 1 });
    expect(p).not.toHaveProperty("schedule");
    expect(p.calls).toHaveLength(2);
    // The MultiSend payload carries both calls, in order.
    expect(p.tx.data).toContain(p.calls[0].data.slice(2));
    expect(p.tx.data.indexOf(p.calls[0].data.slice(2))).toBeLessThan(p.tx.data.indexOf(p.calls[1].data.slice(2)));
    expect(decodeFunctionData({ abi: offeringManagerAbi, data: p.calls[0].data }).functionName).toBe("configure");
    expect(decodeFunctionData({ abi: offeringManagerAbi, data: p.calls[1].data }).functionName).toBe("open");
    // An active project cannot get a new offering.
    const bad = await http().post(`/api/v1/admin/projects/${PID}/offering`).set("Cookie", cookies.reviewer!).send(body).expect(409);
    expect(bad.body.error.code).toBe("PROJECT_STATE_INVALID");
  });

  it("checks subscriber eligibility before preparing settle", async () => {
    await prisma.project.update({ where: { projectIdOnchain: PID2 }, data: { state: "OFFERING" } });
    await prisma.offering.create({
      data: {
        projectIdOnchain: PID2, address: OFFERING2.toLowerCase(), status: "OPEN", unitPrice: (1_000n * ONE).toString(), minUnits: 60, maxUnits: 100,
        perWalletMax: 100, startAt: new Date(0), endAt: new Date(1), treasury: ADDR(0x7e).toLowerCase(), termsHash: keccak256(stringToHex("terms")), unitsSold: 70,
      },
    });
    await prisma.eligibility.create({ data: { wallet: investor.address.toLowerCase(), status: "ELIGIBLE", expiresAt: new Date(Date.now() + 86_400_000), lastBlock: 1n } });
    await prisma.subscription.createMany({
      data: [
        { projectIdOnchain: PID2, wallet: investor.address.toLowerCase(), units: 60, amount: "1", status: "ESCROWED", lastTxHash: "0x1" },
        { projectIdOnchain: PID2, wallet: late.address.toLowerCase(), units: 10, amount: "1", status: "ESCROWED", lastTxHash: "0x2" },
      ],
    });
    // KYC checks are off by default: only frozen wallets block settlement, and any unfrozen wallet may invest.
    await http().post(`/api/v1/admin/offerings/${PID2}/settle`).set("Cookie", cookies.operator!).expect(200);
    const off = await http().get("/api/v1/me/eligibility").set("Cookie", cookies.investor!).expect(200);
    expect(off.body).toMatchObject({ checksRequired: false, eligibleNow: true });
    await prisma.chainEvent.create({
      data: { chainId: 31337, blockNumber: 1n, blockHash: "0x1", txHash: "0xc4ec", logIndex: 0, address: ADDR(0x1d).toLowerCase(), name: "ChecksRequiredSet", args: { required: true, admin: SAFE } },
    });
    const on = await http().get("/api/v1/me/eligibility").set("Cookie", cookies.investor!).expect(200);
    expect(on.body.checksRequired).toBe(true);
    const blocked = await http().post(`/api/v1/admin/offerings/${PID2}/settle`).set("Cookie", cookies.operator!).expect(409);
    expect(blocked.body.error).toMatchObject({ code: "NOT_ELIGIBLE", details: { wallets: [late.address] } });

    const ex = await http().post(`/api/v1/admin/offerings/${PID2}/exclude`).set("Cookie", cookies.reviewer!).send({ wallet: late.address, reason: "KYC lapsed" }).expect(201);
    expect(decodeFunctionData({ abi: offeringManagerAbi, data: ex.body.proposal.calls[0].data }).functionName).toBe("excludeSubscriber");

    await prisma.subscription.update({ where: { projectIdOnchain_wallet: { projectIdOnchain: PID2, wallet: late.address.toLowerCase() } }, data: { status: "REFUNDABLE" } });
    const ok = await http().post(`/api/v1/admin/offerings/${PID2}/settle`).set("Cookie", cookies.operator!).expect(200);
    expect(ok.body.tx.to.toLowerCase()).toBe(OFFERING2.toLowerCase());
  });

  it("prepares a direct reviewer transition or a Safe proposal", async () => {
    const direct = await http().post(`/api/v1/admin/projects/${PID2}/transition`).set("Cookie", cookies.reviewer!).send({ to: "VERIFIED", reason: "documents checked" }).expect(201);
    expect(direct.body.tx).toBeDefined();
    const gov = await http().post(`/api/v1/admin/projects/${PID}/transition`).set("Cookie", cookies.reviewer!).send({ to: "SUSPENDED", reason: "incident" }).expect(201);
    expect(gov.body.proposal.safe).toBe(SAFE);
    // A single call goes to its target directly (operation 0), not through MultiSend.
    expect(gov.body.proposal.tx).toMatchObject({ to: ADDR(0xa55e), operation: 0 });
  });

  it("prepares the project pause set for the Guardian", async () => {
    const r = await http().post("/api/v1/admin/pause").set("Cookie", cookies.reviewer!).send({ scope: "project", projectId: PID, reason: "incident drill" }).expect(201);
    expect(r.body.txs).toHaveLength(3);
    for (const tx of r.body.txs) expect(tx.data).toBe("0x8456cb59"); // pause()
  });

  it("exports holdings as CSV", async () => {
    const r = await http().get(`/api/v1/admin/exports/holdings?projectId=${PID}`).set("Cookie", cookies.reviewer!).expect(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.text.split("\n")[0]).toBe('"wallet","units","last_block"');
    expect(r.text).toContain(`"${investor.address.toLowerCase()}","50","20"`);
  });
});

describe("investor extras", () => {
  it("lists indexed transactions and pending ones", async () => {
    const w = investor.address; // checksummed, as the indexer stores event args
    await prisma.chainEvent.createMany({
      data: [
        { chainId: 31337, blockNumber: 10n, blockHash: "0xb", txHash: "0xaaa1", logIndex: 0, address: ADDR(0x70c).toLowerCase(), name: "Transfer", args: { from: ADDR(0), to: w, value: "60" } },
        { chainId: 31337, blockNumber: 20n, blockHash: "0xc", txHash: "0xaaa2", logIndex: 0, address: ADDR(0x70c).toLowerCase(), name: "Transfer", args: { from: w, to: other.address, value: "10" } },
        { chainId: 31337, blockNumber: 21n, blockHash: "0xd", txHash: "0xaaa3", logIndex: 0, address: ADDR(0x70c).toLowerCase(), name: "Transfer", args: { from: other.address, to: ADDR(5), value: "1" } },
      ],
    });
    const hash = `0x${"ab".repeat(32)}`;
    await http().post("/api/v1/tx/pending").set("Cookie", cookies.investor!).send({ hash, purpose: "CLAIM" }).expect(202);
    // approvals are never indexed, so they are not shown as pending
    await http().post("/api/v1/tx/pending").set("Cookie", cookies.investor!).send({ hash: `0x${"cd".repeat(32)}`, purpose: "APPROVE" }).expect(202);
    const r = await http().get("/api/v1/me/transactions").set("Cookie", cookies.investor!).expect(200);
    expect(r.body.items.map((i: any) => i.kind)).toEqual(["TRANSFER_OUT", "MINT"]);
    expect(r.body.pending).toEqual([expect.objectContaining({ hash, purpose: "CLAIM" })]);
  });

  it("records a risk acknowledgement once per version", async () => {
    const a = await http().post("/api/v1/me/risk-acknowledgement").set("Cookie", cookies.investor!).send({ version: "2026-10" }).expect(201);
    const b = await http().post("/api/v1/me/risk-acknowledgement").set("Cookie", cookies.investor!).send({ version: "2026-10" }).expect(201);
    expect(b.body.acceptedAt).toBe(a.body.acceptedAt);
  });
});

describe("referrals", () => {
  const REWARDS = getAddress(ADDR(0x4ef));
  const ROUTER = getAddress(ADDR(0x40e7));

  beforeAll(async () => {
    const inv = investor.address.toLowerCase();
    const oth = other.address.toLowerCase();
    await prisma.contractDeployment.createMany({
      data: [
        { chainId: 31337, address: REWARDS.toLowerCase(), kind: "REFERRAL_REWARDS", deployedBlock: 1n },
        { chainId: 31337, address: ROUTER.toLowerCase(), kind: "SUBSCRIPTION_ROUTER", deployedBlock: 1n },
      ],
    });
    // investor referred other; other's distributions earned investor a share of the platform fee.
    await prisma.referral.create({ data: { referee: oth, referrer: inv, shareBps: 2_000, expiresAt: new Date(Date.now() + 86_400_000), boundBlock: 9n, boundTxHash: "0x09" } });
    await prisma.referralAccrual.createMany({
      data: [
        { projectIdOnchain: PID, batchIdOnchain: 1, referee: oth, referrer: inv, fee: (625n * ONE).toString(), shareBps: 2_000, reward: (125n * ONE).toString() },
        { projectIdOnchain: PID, batchIdOnchain: 2, referee: oth, referrer: inv, fee: (50n * ONE).toString(), shareBps: 2_000, reward: (10n * ONE).toString() },
      ],
    });
  });

  it("shows earned rewards before any root is published", async () => {
    const r = await http().get("/api/v1/me/referrals").set("Cookie", cookies.investor!).expect(200);
    expect(r.body.contract).toBe(REWARDS);
    expect(r.body.referredBy).toBeNull();
    expect(r.body.referees).toEqual([expect.objectContaining({ wallet: other.address, shareBps: 2_000, active: true, boundAt: null, earned: (135n * ONE).toString() })]);
    expect(r.body.history.map((h: any) => [h.batchId, h.projectTitle, h.reward])).toEqual([
      [2, "Robotaxi 001", (10n * ONE).toString()],
      [1, "Robotaxi 001", (125n * ONE).toString()],
    ]);
    expect(r.body.earned).toBe((135n * ONE).toString());
    expect(r.body.pendingPublication).toBe((135n * ONE).toString());
    expect(r.body.claimable).toBeNull();
  });

  it("prepares a root for the operator only and serves a valid proof once it is live", async () => {
    await http().post("/api/v1/admin/referrals/root").set("Cookie", cookies.reviewer!).expect(403);
    const r = await http().post("/api/v1/admin/referrals/root").set("Cookie", cookies.operator!).expect(201);
    expect(r.body.accounts).toBe(1);
    expect(r.body.totalCumulative).toBe((135n * ONE).toString());
    expect(r.body.tx.to).toBe(REWARDS);
    const call = decodeFunctionData({ abi: referralRewardsAbi, data: r.body.tx.data });
    expect(call.functionName).toBe("setRoot");
    expect(call.args![0]).toBe(r.body.root);

    // Not claimable until the indexer has seen the root on chain.
    expect((await http().get("/api/v1/me/referrals").set("Cookie", cookies.investor!)).body.claimable).toBeNull();
    await prisma.referralRoot.create({ data: { epoch: 1, root: r.body.root, dataHash: r.body.dataHash, totalCumulative: r.body.totalCumulative, blockNumber: 31n, txHash: "0x31" } });
    const me = await http().get("/api/v1/me/referrals").set("Cookie", cookies.investor!).expect(200);
    expect(me.body.claimable.amount).toBe((135n * ONE).toString());
    expect(verifyReferralProof(r.body.root, investor.address, BigInt(me.body.claimable.cumulative), me.body.claimable.proof)).toBe(true);
    expect(me.body.pendingPublication).toBe("0");

    // Same accruals give the same root, so there is nothing new to publish.
    const again = await http().post("/api/v1/admin/referrals/root").set("Cookie", cookies.operator!).expect(409);
    expect(again.body.error.code).toBe("NOTHING_TO_PUBLISH");

    // After a partial claim only the remainder is claimable.
    await prisma.referralClaim.create({ data: { account: investor.address.toLowerCase(), claimed: (135n * ONE).toString(), lastTxHash: "0x32" } });
    const after = await http().get("/api/v1/me/referrals").set("Cookie", cookies.investor!).expect(200);
    expect(after.body.claimable).toBeNull();
    expect(after.body.claimed).toBe((135n * ONE).toString());
  });

  it("summarises the programme for staff", async () => {
    const r = await http().get("/api/v1/admin/referrals").set("Cookie", cookies.reviewer!).expect(200);
    expect(r.body.bindings).toBe(1);
    expect(r.body.totalAccrued).toBe((135n * ONE).toString());
    expect(r.body.outstanding).toBe("0");
    expect(r.body.topReferrers).toEqual([{ referrer: investor.address, accrued: (135n * ONE).toString() }]);
  });

  it("wraps the on/off switch for both contracts in one Safe batch", async () => {
    await http().post("/api/v1/admin/referrals/terms").set("Cookie", cookies.operator!).send({ enabled: true, shareBps: 2_000, windowDays: 365 }).expect(403);
    await http().post("/api/v1/admin/referrals/terms").set("Cookie", cookies.reviewer!).send({ enabled: true, shareBps: 6_000, windowDays: 365 }).expect(400);
    const r = await http().post("/api/v1/admin/referrals/terms").set("Cookie", cookies.reviewer!).send({ enabled: true, shareBps: 2_000, windowDays: 365 }).expect(201);
    expect(r.body.safe).toBe(SAFE);
    expect(r.body.tx.to).toBe(MULTISEND);
    expect(r.body.calls.map((c: any) => c.to)).toEqual([ROUTER, REWARDS]);
    const terms = decodeFunctionData({ abi: subscriptionRouterAbi, data: r.body.calls[0].data });
    expect(terms.functionName).toBe("setReferralTerms");
    expect(terms.args).toEqual([true, 2_000, 365n * 86_400n]);
    expect(decodeFunctionData({ abi: referralRewardsAbi, data: r.body.calls[1].data }).functionName).toBe("setClaimsEnabled");
  });

  it("lists the second level: people your referrals invited", async () => {
    const inv = investor.address.toLowerCase();
    const third = ADDR(0xc3);
    await prisma.referral.create({ data: { referee: third, referrer: other.address.toLowerCase(), shareBps: 2_000, expiresAt: new Date(Date.now() + 86_400_000), boundBlock: 12n, boundTxHash: "0x12" } });
    await prisma.referralAccrual.create({
      data: { projectIdOnchain: PID, batchIdOnchain: 3, referee: third, level: 2, referrer: inv, fee: (100n * ONE).toString(), shareBps: REFERRAL_LEVEL2_SHARE_BPS, reward: (5n * ONE).toString() },
    });
    const r = await http().get("/api/v1/me/referrals").set("Cookie", cookies.investor!).expect(200);
    expect(r.body.level2ShareBps).toBe(REFERRAL_LEVEL2_SHARE_BPS);
    expect(r.body.referees).toHaveLength(1);
    expect(r.body.referees[0].earned).toBe((135n * ONE).toString());
    expect(r.body.level2).toEqual([
      expect.objectContaining({ wallet: getAddress(third), via: other.address, shareBps: REFERRAL_LEVEL2_SHARE_BPS, active: true, earned: (5n * ONE).toString() }),
    ]);
    expect(r.body.history[0]).toEqual(expect.objectContaining({ batchId: 3, level: 2, referee: getAddress(third), reward: (5n * ONE).toString() }));
    expect(r.body.earned).toBe((140n * ONE).toString());
  });
});

describe("rate limiting", () => {
  it("returns 429 past the per-minute limit", async () => {
    const strict = await createApp({ ...cfg, rateLimitPerMinute: 3 });
    await strict.init();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await request(strict.getHttpServer()).get("/api/v1/health")).status);
      expect(statuses).toContain(429);
      const r = await request(strict.getHttpServer()).get("/api/v1/health");
      expect(r.body.error?.code).toBe("RATE_LIMITED");
    } finally {
      await strict.close();
    }
  });
});
