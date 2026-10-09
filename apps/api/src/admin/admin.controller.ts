import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Prisma } from "@roboshare/db";
import {
  allocate,
  assetRegistryAbi,
  auditRegistryAbi,
  canonicalJson,
  dateToUnix,
  financialReportSchema,
  revenueDistributorAbi,
  reportHash,
  type FinancialReport,
} from "@roboshare/shared";
import { getAddress, keccak256, stringToHex, toHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { Roles, RoleGuard, type AuthedRequest } from "../auth/guards.js";
import { ApiError, notFound } from "../common/errors.js";
import { PrismaService } from "../common/prisma.service.js";
import { lc, plain } from "../common/serialize.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { prepare } from "./prepare.js";

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const RECORD_KIND_FINANCIAL_REPORT = 1;

const createProjectBody = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,64}$/),
  title: z.string().min(1).max(120),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  modelYear: z.number().int().min(2000).max(2100).optional(),
  summary: z.string().max(2000).optional(),
  /** Off-chain asset reference (e.g. a salted VIN hash computed by the operator). Only its hash goes on-chain. */
  assetRef: z.string().min(8).max(200),
  issuerId: bytes32,
  rightsDocHash: bytes32,
});

const reviewBody = z.object({ decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().max(500).optional() });

const distributionBody = z.object({
  projectId: bytes32,
  reportRecordId: bytes32,
  amount: z.string().regex(/^[1-9][0-9]*$/),
  snapshotBlock: z.coerce.bigint().positive(),
});
type DistributionBody = z.infer<typeof distributionBody>;

@Controller("admin")
@UseGuards(RoleGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ---------------------------------------------------------------- projects

  @Post("projects")
  @Roles("OPERATOR")
  async createProject(@Req() req: AuthedRequest, @Body(new ZodPipe(createProjectBody)) body: z.infer<typeof createProjectBody>) {
    const registry = this.need(this.cfg.assetRegistry, "ASSET_REGISTRY");
    const projectId = keccak256(stringToHex(`roboshare:project:${body.slug}`));
    const assetId = keccak256(stringToHex(body.assetRef));
    if (await this.prisma.projectMeta.findUnique({ where: { slug: body.slug } })) {
      throw new ApiError(409, "CONFLICT", "slug already used");
    }
    await this.prisma.projectMeta.create({
      data: { projectIdOnchain: projectId, slug: body.slug, title: body.title, make: body.make, model: body.model, modelYear: body.modelYear, summary: body.summary },
    });
    await this.audit(req, "PROJECT_CREATE", "project", projectId, body);
    return {
      projectId,
      assetId,
      tx: prepare(this.cfg.chainId, registry, assetRegistryAbi, "registerProject", [projectId, assetId, body.issuerId, body.rightsDocHash], "Register the project draft (operator wallet)"),
    };
  }

  // ---------------------------------------------------------------- reports

  @Post("reports")
  @Roles("OPERATOR")
  async submitReport(@Req() req: AuthedRequest, @Body(new ZodPipe(financialReportSchema)) report: FinancialReport) {
    const auditRegistry = this.need(this.cfg.auditRegistry, "AUDIT_REGISTRY");
    if (this.cfg.paymentToken && lc(report.paymentToken) !== lc(this.cfg.paymentToken)) {
      throw new ApiError(400, "REPORT_INVALID", "paymentToken must be the platform USDT");
    }
    const project = await this.prisma.project.findUnique({ where: { projectIdOnchain: report.projectId } });
    if (!project) throw notFound("project");
    if (!["ACTIVE", "EXIT_PENDING", "TERMINATED", "SUSPENDED"].includes(project.state)) {
      throw new ApiError(409, "PROJECT_STATE_INVALID", `project is ${project.state}`);
    }
    const approved = await this.prisma.financialReport.findFirst({
      where: {
        projectIdOnchain: report.projectId,
        status: "APPROVED",
        periodStart: { lt: new Date(report.periodEnd) },
        periodEnd: { gt: new Date(report.periodStart) },
      },
    });
    if (approved) throw new ApiError(409, "PERIOD_ALREADY_APPROVED", "an approved report already covers this period; submit an amendment");

    const hash = reportHash(report);
    const sum = (xs: { amount: string }[]) => xs.reduce((s, x) => s + BigInt(x.amount), 0n).toString();
    let created;
    try {
      created = await this.prisma.financialReport.create({
        data: {
          projectIdOnchain: report.projectId,
          periodStart: new Date(report.periodStart),
          periodEnd: new Date(report.periodEnd),
          paymentToken: lc(report.paymentToken),
          grossRevenue: sum(report.revenue),
          totalExpenses: sum(report.expenses),
          totalReserves: sum(report.reserves),
          distributableAmount: report.distributableAmount,
          canonicalHash: hash,
          body: report as unknown as Prisma.InputJsonValue,
          submittedByUserId: req.session!.userId,
          submittedByWallet: req.session!.wallet,
          lines: {
            create: [
              ...report.revenue.map((l) => ({ section: "REVENUE" as const, category: l.category, description: l.description, amount: l.amount })),
              ...report.expenses.map((l) => ({ section: "EXPENSE" as const, category: l.category, description: l.description, amount: l.amount })),
              ...report.reserves.map((l) => ({ section: "RESERVE" as const, category: l.kind, description: l.rationale, amount: l.amount })),
            ],
          },
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError(409, "CONFLICT", "an identical report was already submitted");
      }
      throw e;
    }
    await this.audit(req, "REPORT_SUBMIT", "financial_report", created.id, report);
    const input = {
      projectId: report.projectId as Hex,
      kind: RECORD_KIND_FINANCIAL_REPORT,
      contentHash: hash,
      docType: toHex("PNL_REPORT", { size: 32 }),
      offchainRef: keccak256(stringToHex(created.id)),
      periodStart: dateToUnix(report.periodStart),
      periodEnd: dateToUnix(report.periodEnd),
      distributableAmount: BigInt(report.distributableAmount),
      paymentToken: getAddress(report.paymentToken),
    };
    return plain({
      id: created.id,
      canonicalHash: hash,
      status: created.status,
      tx: prepare(this.cfg.chainId, auditRegistry, auditRegistryAbi, "submitRecord", [input], "Anchor the report hash in AuditRegistry (operator wallet)"),
    });
  }

  @Post("reports/:id/review")
  @Roles("REVIEWER")
  @HttpCode(200)
  async review(@Req() req: AuthedRequest, @Param("id") id: string, @Body(new ZodPipe(reviewBody)) body: z.infer<typeof reviewBody>) {
    const auditRegistry = this.need(this.cfg.auditRegistry, "AUDIT_REGISTRY");
    const report = await this.prisma.financialReport.findUnique({ where: { id } }).catch(() => null);
    if (!report) throw notFound("report");
    if (report.submittedByUserId === req.session!.userId || report.submittedByWallet === req.session!.wallet) {
      throw new ApiError(403, "SELF_REVIEW_FORBIDDEN", "the submitter cannot review their own report");
    }
    if (!report.recordIdOnchain) throw new ApiError(409, "REPORT_NOT_ANCHORED", "submit the report on-chain first");
    if (report.status !== "SUBMITTED") throw new ApiError(409, "REPORT_INVALID", `report is ${report.status}`);
    if (body.decision === "REJECT" && !body.reason) throw new ApiError(400, "VALIDATION_FAILED", "a reason is required to reject");

    await this.prisma.reportReview.create({
      data: { reportId: id, reviewerUserId: req.session!.userId, decision: body.decision, reason: body.reason },
    });
    await this.audit(req, `REPORT_${body.decision}`, "financial_report", id, body);
    const recordId = report.recordIdOnchain as Hex;
    const tx =
      body.decision === "APPROVE"
        ? prepare(this.cfg.chainId, auditRegistry, auditRegistryAbi, "approve", [recordId], "Approve the anchored report (reviewer wallet)")
        : prepare(this.cfg.chainId, auditRegistry, auditRegistryAbi, "reject", [recordId, keccak256(stringToHex(body.reason!))], "Reject the anchored report (reviewer wallet)");
    return { reportId: id, decision: body.decision, tx };
  }

  // ---------------------------------------------------------------- distributions

  @Post("distributions/preview")
  @Roles("OPERATOR")
  @HttpCode(200)
  async preview(@Body(new ZodPipe(distributionBody)) body: DistributionBody) {
    const p = await this.planDistribution(body);
    return plain({ ...p.result, holders: p.holders, figureKind: "PROJECTED", note: "Preview only. The contract computes the binding allocation." });
  }

  @Post("distributions")
  @Roles("OPERATOR")
  async propose(@Req() req: AuthedRequest, @Body(new ZodPipe(distributionBody)) body: DistributionBody) {
    const p = await this.planDistribution(body);
    await this.audit(req, "DISTRIBUTION_PREPARE", "project", body.projectId, body);
    return plain({
      preview: p.result,
      tx: prepare(
        this.cfg.chainId,
        p.distributor,
        revenueDistributorAbi,
        "proposeBatch",
        [body.reportRecordId, BigInt(body.amount), body.snapshotBlock, p.holders.map((h) => getAddress(h.address))],
        "Propose the distribution batch (operator wallet); a different reviewer approves it",
      ),
    });
  }

  private async planDistribution(body: DistributionBody) {
    const project = await this.prisma.project.findUnique({ where: { projectIdOnchain: body.projectId } });
    if (!project?.distributorAddress) throw notFound("project");
    if (!["ACTIVE", "EXIT_PENDING", "TERMINATED"].includes(project.state)) {
      throw new ApiError(409, "PROJECT_STATE_INVALID", `project is ${project.state}`);
    }
    const lastRun = await this.prisma.reconciliationRun.findFirst({ orderBy: { runAt: "desc" } });
    if (lastRun && !lastRun.ok) {
      throw new ApiError(409, "RECONCILIATION_BLOCKED", "the last reconciliation found differences; resolve them first");
    }
    const record = await this.prisma.auditRecord.findUnique({ where: { recordIdOnchain: body.reportRecordId } });
    if (!record || record.projectIdOnchain !== body.projectId || record.kind !== "FINANCIAL_REPORT" || record.status !== "APPROVED") {
      throw new ApiError(409, "REPORT_INVALID", "report is not an approved financial report of this project");
    }
    const cursor = await this.prisma.indexerCursor.findUnique({ where: { chainId: this.cfg.chainId } });
    if (!cursor || body.snapshotBlock > cursor.lastBlock || body.snapshotBlock < (project.fundedAtBlock ?? 0n)) {
      throw new ApiError(409, "SNAPSHOT_OUT_OF_RANGE", "snapshot must be between funding and the last indexed block");
    }
    // Same period key as the contract: earlier batches funded from any version of this period count.
    const samePeriod = await this.prisma.auditRecord.findMany({
      where: { projectIdOnchain: body.projectId, periodStart: record.periodStart, periodEnd: record.periodEnd },
      select: { recordIdOnchain: true },
    });
    const done = await this.prisma.distributionBatch.findMany({
      where: { projectIdOnchain: body.projectId, reportId: { in: samePeriod.map((r) => r.recordIdOnchain) }, status: { in: ["PROPOSED", "CLAIMABLE"] } },
      select: { amount: true },
    });
    const used = done.reduce((s, b) => s + BigInt(b.amount.toFixed()), 0n);
    const remaining = BigInt(record.distributableAmount.toFixed()) - used;
    if (BigInt(body.amount) > remaining) {
      throw new ApiError(409, "AMOUNT_EXCEEDS_REPORT", "amount exceeds what is left on this report", { remaining: remaining.toString() });
    }

    const holders = await this.holdersAt(body.projectId, body.snapshotBlock);
    if (holders.length === 0) throw new ApiError(409, "REPORT_INVALID", "no holders at the snapshot block");
    const lastBatch = await this.prisma.distributionBatch.findFirst({
      where: { projectIdOnchain: body.projectId, status: "CLAIMABLE" },
      orderBy: { batchIdOnchain: "desc" },
    });
    const carriedDust = lastBatch ? BigInt(lastBatch.dustOut.toFixed()) : 0n;
    const result = allocate(BigInt(body.amount), carriedDust, holders);
    return { result: { ...result, carriedDustIn: carriedDust }, holders, distributor: getAddress(project.distributorAddress) as Address };
  }

  /** Balances at a block, replayed from indexed transfers; sorted ascending as proposeBatch requires. */
  private async holdersAt(projectId: string, block: bigint) {
    const rows = await this.prisma.tokenTransfer.findMany({
      where: { projectIdOnchain: projectId, blockNumber: { lte: block } },
      select: { fromAddress: true, toAddress: true, units: true },
    });
    const bal = new Map<string, number>();
    const zero = "0x0000000000000000000000000000000000000000";
    for (const t of rows) {
      if (t.fromAddress !== zero) bal.set(t.fromAddress, (bal.get(t.fromAddress) ?? 0) - t.units);
      if (t.toAddress !== zero) bal.set(t.toAddress, (bal.get(t.toAddress) ?? 0) + t.units);
    }
    return [...bal]
      .filter(([, u]) => u > 0)
      .map(([address, units]) => ({ address, units }))
      .sort((a, b) => (a.address < b.address ? -1 : 1));
  }

  // ---------------------------------------------------------------- read-only admin views

  @Get("roles")
  @Roles("OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW")
  async roles() {
    const grants = await this.prisma.roleGrant.findMany({ where: { chainId: this.cfg.chainId, active: true } });
    return { items: grants.map((g) => ({ contract: getAddress(g.contract), role: g.role, account: getAddress(g.account) })) };
  }

  @Get("reconciliation")
  @Roles("OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW")
  async reconciliation() {
    const runs = await this.prisma.reconciliationRun.findMany({ orderBy: { runAt: "desc" }, take: 10, include: { issues: true } });
    return plain({ items: runs });
  }

  @Get("audit-log")
  @Roles("OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW")
  async auditLog(@Query("limit") limit?: string) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return plain({ items: await this.prisma.adminAction.findMany({ orderBy: { createdAt: "desc" }, take }) });
  }

  private need(addr: Address | undefined, name: string): Address {
    if (!addr) throw new ApiError(503, "CHAIN_UNAVAILABLE", `${name} is not configured`);
    return addr;
  }

  private async audit(req: AuthedRequest, action: string, targetType: string, targetId: string, payload: unknown) {
    await this.prisma.adminAction.create({
      data: {
        userId: req.session!.userId,
        wallet: req.session!.wallet,
        action,
        targetType,
        targetId,
        payloadHash: keccak256(stringToHex(canonicalJson(payload))),
      },
    });
  }
}
