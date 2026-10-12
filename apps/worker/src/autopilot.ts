import type { PrismaClient } from "@roboshare/db";
import { auditRegistryAbi, canonicalJson, dateToUnix, financialReportSchema, reportHash, revenueDistributorAbi, type FinancialReport } from "@roboshare/shared";
import {
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  stringToHex,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * Monthly profit distribution without anyone clicking (Charlene's choice, 2026-10-11, ADMIN_AUTOMATION_PLAN.md).
 *
 * Two server wallets with the smallest roles that do the job, both granted by the governance Safe and revocable by it:
 * - the submitter holds OPERATOR_ROLE on the AuditRegistry and each project's RevenueDistributor: it anchors the
 *   monthly report and proposes the batch;
 * - the approver holds REVIEWER_ROLE on the same contracts: it approves the report and the batch. The contracts refuse
 *   self-approval, so the two keys must differ.
 * Neither wallet can change parameters, roles or contracts, or send funds anywhere except to holders pro rata through
 * the distributor. Each batch is capped (maxBatch); a month above the cap waits for staff in the console.
 */
export interface AutopilotConfig {
  chainId: number;
  rpcUrl: string;
  auditRegistry: Address;
  paymentToken: Address;
  submitterKey: Hex;
  approverKey: Hex;
  /** Largest monthly batch sent without a person, in token base units. */
  maxBatch: bigint;
  /** Months are calendar months in this UTC offset (Beijing = 8). */
  utcOffsetHours: number;
  /** Day of the month (local) from which last month's report is made, leaving time for late daily entries. */
  reportDay: number;
}

/** Operating totals for [start, end) in token base units, from the daily operating data. null = no data. */
export type PeriodTotals = (projectId: string, start: string, end: string) => Promise<{ revenue: bigint; expenses: bigint; days: number } | null>;

const RECORD_KIND_FINANCIAL_REPORT = 1;
const RECEIPT_TIMEOUT_MS = 120_000;
const ISSUE_REPEAT_MS = 6 * 3600_000;

/** Sums the console's daily operating entries for [start, end). */
export function dailyOperatingTotals(prisma: PrismaClient): PeriodTotals {
  return async (projectId, start, end) => {
    const rows = await prisma.dailyOperating.findMany({ where: { projectIdOnchain: projectId, day: { gte: new Date(start), lt: new Date(end) } } });
    if (!rows.length) return null;
    const sum = (k: "revenue" | "expenses") => rows.reduce((s, r) => s + BigInt(r[k].toFixed()), 0n);
    return { revenue: sum("revenue"), expenses: sum("expenses"), days: rows.length };
  };
}

export function loadAutopilotConfig(env: NodeJS.ProcessEnv = process.env): AutopilotConfig | null {
  const s = env.AUTOPILOT_SUBMITTER_KEY;
  const a = env.AUTOPILOT_APPROVER_KEY;
  if (!s || !a || env.AUTOPILOT_ENABLED === "false") return null;
  if (!env.AUDIT_REGISTRY || !env.PAYMENT_TOKEN) throw new Error("autopilot needs AUDIT_REGISTRY and PAYMENT_TOKEN");
  if (s.toLowerCase() === a.toLowerCase()) throw new Error("AUTOPILOT_SUBMITTER_KEY and AUTOPILOT_APPROVER_KEY must differ");
  const maxUsdt = BigInt(env.AUTOPILOT_MAX_BATCH_USDT ?? "100000");
  return {
    chainId: Number(env.CHAIN_ID),
    rpcUrl: env.RPC_URL!,
    auditRegistry: getAddress(env.AUDIT_REGISTRY),
    paymentToken: getAddress(env.PAYMENT_TOKEN),
    submitterKey: s as Hex,
    approverKey: a as Hex,
    maxBatch: maxUsdt * 10n ** 18n,
    utcOffsetHours: Number(env.AUTOPILOT_UTC_OFFSET_HOURS ?? 8),
    reportDay: Number(env.AUTOPILOT_REPORT_DAY ?? 2),
  };
}

/** The calendar month before `now` in the given offset, as [start, end) dates (YYYY-MM-DD). */
export function previousMonth(now: Date, utcOffsetHours: number): { start: string; end: string } {
  const local = new Date(now.getTime() + utcOffsetHours * 3600_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const end = new Date(Date.UTC(y, m, 1));
  const start = new Date(Date.UTC(y, m - 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** The report the autopilot anchors for a month. Deterministic, so a retry produces the same hash. */
export function monthlyReport(projectId: string, paymentToken: Address, start: string, end: string, revenue: bigint, expenses: bigint, days: number): FinancialReport {
  return financialReportSchema.parse({
    projectId,
    periodStart: start,
    periodEnd: end,
    paymentToken: paymentToken.toLowerCase(),
    revenue: [{ category: "RIDES", description: `Robotaxi operating revenue, ${days} day(s) recorded`, amount: revenue.toString() }],
    expenses: expenses > 0n ? [{ category: "OPERATING", description: "Charging, cleaning, insurance and other operating costs", amount: expenses.toString() }] : [],
    reserves: [],
    distributableAmount: (revenue - expenses).toString(),
  });
}

export interface AutopilotEvent {
  projectId: string;
  kind: string;
  message: string;
  txHash?: string;
}

export class Autopilot {
  readonly submitter: PrivateKeyAccount;
  readonly approver: PrivateKeyAccount;
  private readonly lastIssue = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly pub: PublicClient,
    private readonly cfg: AutopilotConfig,
    private readonly totals: PeriodTotals,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.submitter = privateKeyToAccount(cfg.submitterKey);
    this.approver = privateKeyToAccount(cfg.approverKey);
  }

  /** One pass over every operating project. Each step is idempotent against the chain, so a crash just retries. */
  async tick(): Promise<AutopilotEvent[]> {
    const events: AutopilotEvent[] = [];
    const projects = await this.prisma.project.findMany({ where: { state: { in: ["ACTIVE", "EXIT_PENDING"] }, distributorAddress: { not: null } } });
    for (const p of projects) {
      try {
        await this.project(p.projectIdOnchain, getAddress(p.distributorAddress!), events);
      } catch (err) {
        await this.issue(events, p.projectIdOnchain, "ERROR", String(err).split("\n")[0]!.slice(0, 300));
      }
    }
    for (const e of events) {
      await this.prisma.automationEvent.create({ data: { chainId: this.cfg.chainId, projectIdOnchain: e.projectId, kind: e.kind, message: e.message, txHash: e.txHash } });
    }
    return events;
  }

  private async project(projectId: string, distributor: Address, events: AutopilotEvent[]) {
    const submitter = this.submitter.address.toLowerCase();
    // 1. Anchor last month's report once the month is over.
    const now = this.now();
    const { start, end } = previousMonth(now, this.cfg.utcOffsetHours);
    const localDay = new Date(now.getTime() + this.cfg.utcOffsetHours * 3600_000).getUTCDate();
    const existing = await this.prisma.financialReport.findFirst({
      where: { projectIdOnchain: projectId, periodStart: new Date(start), periodEnd: new Date(end), status: { not: "REJECTED" } },
    });
    if (!existing && localDay >= this.cfg.reportDay) await this.createReport(projectId, start, end, events);

    // 2. Approve the autopilot's own reports (the contract requires a different wallet from the submitter).
    const mine = await this.prisma.financialReport.findMany({
      where: { projectIdOnchain: projectId, submittedByWallet: submitter, status: { in: ["SUBMITTED", "APPROVED"] }, recordIdOnchain: { not: null } },
      orderBy: { periodStart: "asc" },
    });
    for (const r of mine.filter((x) => x.status === "SUBMITTED")) {
      const rec = (await this.read(this.cfg.auditRegistry, auditRegistryAbi, "getRecord", [r.recordIdOnchain])) as { status: number };
      if (rec.status !== 1) continue; // SUBMITTED on-chain
      const hash = await this.send(this.approver, this.cfg.auditRegistry, auditRegistryAbi, "approve", [r.recordIdOnchain]);
      await this.prisma.reportReview.create({ data: { reportId: r.id, reviewerUserId: await this.userOf(this.approver.address), decision: "APPROVE", reason: "automatic monthly report" } });
      events.push({ projectId, kind: "REPORT_APPROVED", message: `${r.periodStart.toISOString().slice(0, 7)} report approved`, txHash: hash });
    }

    // 3. Approve a pending batch the autopilot proposed, once the treasury has the money and the allowance.
    const pendingId = (await this.read(distributor, revenueDistributorAbi, "pendingBatchId")) as bigint;
    if (pendingId !== 0n) {
      const b = (await this.read(distributor, revenueDistributorAbi, "getBatch", [pendingId])) as { amount: bigint; proposer: Address };
      if (b.proposer.toLowerCase() !== submitter) return; // a staff batch: staff approve it
      const treasury = (await this.read(distributor, revenueDistributorAbi, "treasury")) as Address;
      const [balance, allowance] = await Promise.all([
        this.read(this.cfg.paymentToken, erc20Abi, "balanceOf", [treasury]) as Promise<bigint>,
        this.read(this.cfg.paymentToken, erc20Abi, "allowance", [treasury, distributor]) as Promise<bigint>,
      ]);
      if (balance < b.amount || allowance < b.amount) {
        await this.issue(events, projectId, "TREASURY_SHORT", `treasury ${treasury} needs ${b.amount} (balance ${balance}, allowance ${allowance})`);
        return;
      }
      const hash = await this.send(this.approver, distributor, revenueDistributorAbi, "approveBatch", [pendingId]);
      events.push({ projectId, kind: "BATCH_APPROVED", message: `batch ${pendingId} is claimable`, txHash: hash });
      return;
    }

    // 4. Propose a batch for an approved autopilot report that has none yet.
    for (const r of mine.filter((x) => x.status === "APPROVED")) {
      const done = await this.prisma.distributionBatch.findFirst({ where: { projectIdOnchain: projectId, reportId: r.recordIdOnchain!, status: { in: ["PROPOSED", "CLAIMABLE"] } } });
      if (done) continue;
      const amount = BigInt(r.distributableAmount.toFixed());
      if (amount === 0n) continue;
      if (amount > this.cfg.maxBatch) {
        await this.issue(events, projectId, "OVER_CAP", `report ${r.id} distributes ${amount}, above the automatic cap ${this.cfg.maxBatch}; propose it in the console`);
        continue;
      }
      const recon = await this.prisma.reconciliationRun.findFirst({ orderBy: { runAt: "desc" } });
      if (recon && !recon.ok) {
        await this.issue(events, projectId, "RECONCILIATION_BLOCKED", "the last reconciliation found differences; distribution waits");
        return;
      }
      const project = await this.prisma.project.findUniqueOrThrow({ where: { projectIdOnchain: projectId } });
      const cursor = await this.prisma.indexerCursor.findUnique({ where: { chainId: this.cfg.chainId } });
      if (!cursor || cursor.lastBlock < (project.fundedAtBlock ?? 0n)) return;
      // Strictly before the block the proposal lands in (the token's checkpoints only answer for past blocks).
      const head = await this.pub.getBlockNumber();
      const snapshot = cursor.lastBlock < head ? cursor.lastBlock : head - 1n;
      const holders = await this.holdersAt(projectId, snapshot);
      if (!holders.length) return;
      const hash = await this.send(this.submitter, distributor, revenueDistributorAbi, "proposeBatch", [r.recordIdOnchain, amount, snapshot, holders]);
      events.push({ projectId, kind: "BATCH_PROPOSED", message: `${r.periodStart.toISOString().slice(0, 7)}: ${amount} to ${holders.length} holder(s)`, txHash: hash });
      return; // one pending batch per distributor
    }
  }

  private async createReport(projectId: string, start: string, end: string, events: AutopilotEvent[]) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { projectIdOnchain: projectId } });
    // Only months that start after the vehicle went into service; the first partial month rolls into the next report.
    const activated = await this.prisma.projectStateChange.findFirst({ where: { projectIdOnchain: projectId, toState: "ACTIVE" }, orderBy: { blockNumber: "asc" } });
    if (!activated || !project.fundedAtBlock) return;
    const t = await this.totals(projectId, start, end);
    if (!t || t.days === 0 || t.revenue === 0n) return;
    if (t.expenses > t.revenue) {
      await this.issue(events, projectId, "LOSS_MONTH", `${start.slice(0, 7)} expenses exceed revenue; nothing to distribute`);
      return;
    }
    const report = monthlyReport(projectId, this.cfg.paymentToken, start, end, t.revenue, t.expenses, t.days);
    const hash = reportHash(report);
    const recordId = (await this.read(this.cfg.auditRegistry, auditRegistryAbi, "computeRecordId", [projectId, RECORD_KIND_FINANCIAL_REPORT, hash])) as Hex;
    const row = await this.prisma.financialReport.upsert({
      where: { canonicalHash: hash },
      update: {},
      create: {
        projectIdOnchain: projectId,
        periodStart: new Date(start),
        periodEnd: new Date(end),
        paymentToken: report.paymentToken,
        grossRevenue: t.revenue.toString(),
        totalExpenses: t.expenses.toString(),
        totalReserves: "0",
        distributableAmount: report.distributableAmount,
        canonicalHash: hash,
        body: JSON.parse(canonicalJson(report)),
        submittedByUserId: await this.userOf(this.submitter.address),
        submittedByWallet: this.submitter.address.toLowerCase(),
        lines: {
          create: [
            ...report.revenue.map((l) => ({ section: "REVENUE" as const, category: l.category, description: l.description, amount: l.amount })),
            ...report.expenses.map((l) => ({ section: "EXPENSE" as const, category: l.category, description: l.description, amount: l.amount })),
          ],
        },
      },
    });
    const rec = (await this.read(this.cfg.auditRegistry, auditRegistryAbi, "getRecord", [recordId])) as { status: number };
    if (rec.status !== 0) return; // already anchored; the indexer links it
    const input = {
      projectId: projectId as Hex,
      kind: RECORD_KIND_FINANCIAL_REPORT,
      contentHash: hash,
      docType: toHex("PNL_REPORT", { size: 32 }),
      offchainRef: keccak256(stringToHex(row.id)),
      periodStart: dateToUnix(start),
      periodEnd: dateToUnix(end),
      distributableAmount: BigInt(report.distributableAmount),
      paymentToken: this.cfg.paymentToken,
    };
    const tx = await this.send(this.submitter, this.cfg.auditRegistry, auditRegistryAbi, "submitRecord", [input]);
    events.push({ projectId, kind: "REPORT_SUBMITTED", message: `${start.slice(0, 7)} report: revenue ${t.revenue}, expenses ${t.expenses}`, txHash: tx });
  }

  /** Balances at a block, replayed from indexed transfers; sorted ascending as proposeBatch requires. */
  private async holdersAt(projectId: string, block: bigint): Promise<Address[]> {
    const rows = await this.prisma.tokenTransfer.findMany({ where: { projectIdOnchain: projectId, blockNumber: { lte: block } }, select: { fromAddress: true, toAddress: true, units: true } });
    const bal = new Map<string, number>();
    const zero = "0x0000000000000000000000000000000000000000";
    for (const t of rows) {
      if (t.fromAddress !== zero) bal.set(t.fromAddress, (bal.get(t.fromAddress) ?? 0) - t.units);
      if (t.toAddress !== zero) bal.set(t.toAddress, (bal.get(t.toAddress) ?? 0) + t.units);
    }
    return [...bal].filter(([, u]) => u > 0).map(([a]) => a).sort().map((a) => getAddress(a));
  }

  /** The app user that stands for an automation wallet (reports and reviews point at a user). */
  private async userOf(address: Address): Promise<string> {
    const w = await this.prisma.wallet.findUnique({ where: { address: address.toLowerCase() } });
    if (w) return w.userId;
    const u = await this.prisma.user.create({ data: { wallets: { create: { address: address.toLowerCase() } } } });
    return u.id;
  }

  private async issue(events: AutopilotEvent[], projectId: string, kind: string, message: string) {
    const key = `${projectId}:${kind}:${message}`;
    const last = this.lastIssue.get(key) ?? 0;
    if (Date.now() - last < ISSUE_REPEAT_MS) return;
    this.lastIssue.set(key, Date.now());
    events.push({ projectId, kind, message });
  }

  private read(address: Address, abi: Abi, functionName: string, args: unknown[] = []) {
    return this.pub.readContract({ address, abi, functionName, args } as never);
  }

  private async send(account: PrivateKeyAccount, address: Address, abi: Abi, functionName: string, args: unknown[]): Promise<Hex> {
    const wallet = createWalletClient({ account, transport: http(this.cfg.rpcUrl) });
    const { request } = await this.pub.simulateContract({ account, address, abi, functionName, args } as never);
    const hash = await wallet.writeContract({ ...(request as object), chain: null } as never);
    const receipt = await this.pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
    return hash;
  }
}
