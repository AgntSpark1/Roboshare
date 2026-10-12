import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { auditRegistryAbi, canonicalJson, revenueDistributorAbi } from "@roboshare/shared";
import { getAddress, keccak256, stringToHex, type Abi, type Address } from "viem";
import { z } from "zod";
import { Roles, RoleGuard, type AuthedRequest } from "../auth/guards.js";
import { ApiError, notFound } from "../common/errors.js";
import { IdempotencyInterceptor } from "../common/idempotency.js";
import { PrismaService } from "../common/prisma.service.js";
import { lc, plain } from "../common/serialize.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { beijingToday } from "./operating.js";
import { call, queueSafe, viaSafe, type Call } from "./prepare.js";

const OPERATOR_ROLE = keccak256(stringToHex("OPERATOR_ROLE"));
const REVIEWER_ROLE = keccak256(stringToHex("REVIEWER_ROLE"));
const ISSUE_KINDS = ["TREASURY_SHORT", "OVER_CAP", "LOSS_MONTH", "RECONCILIATION_BLOCKED", "ERROR"];

const rolesBody = z.object({ action: z.enum(["grant", "revoke"]) });
const amount = z.string().regex(/^(0|[1-9][0-9]{0,40})$/, "amount must be a base-unit integer string");
const dailyBody = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  revenue: amount,
  expenses: amount,
  rides: z.number().int().min(0).max(100_000).optional(),
  note: z.string().max(300).optional(),
});

/**
 * The monthly distribution autopilot (apps/worker/src/autopilot.ts) as staff see it: which contracts its two wallets
 * hold roles on, what it did, and what it waits on. Granting and revoking go through the governance Safe queue.
 */
@Controller("admin/autopilot")
@UseGuards(RoleGuard)
@UseInterceptors(IdempotencyInterceptor)
export class AutopilotController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get()
  @Roles("OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW")
  async status() {
    const { submitter, approver } = this.wallets(false);
    const targets = await this.targets();
    const grants = submitter && approver
      ? await this.prisma.roleGrant.findMany({
          where: { chainId: this.cfg.chainId, active: true, account: { in: [lc(submitter), lc(approver)] }, role: { in: [OPERATOR_ROLE, REVIEWER_ROLE] } },
        })
      : [];
    const has = (contract: string, role: string, account?: string) =>
      !!account && grants.some((g) => lc(g.contract) === lc(contract) && g.role === role && lc(g.account) === lc(account));
    const contracts = targets.map((t) => ({ ...t, submitterOk: has(t.address, OPERATOR_ROLE, submitter), approverOk: has(t.address, REVIEWER_ROLE, approver) }));
    const events = await this.prisma.automationEvent.findMany({ where: { chainId: this.cfg.chainId }, orderBy: { createdAt: "desc" }, take: 50 });
    const since = new Date(Date.now() - 3 * 86_400_000);
    const issues = events.filter((e) => ISSUE_KINDS.includes(e.kind) && e.createdAt >= since);
    return plain({
      configured: !!(submitter && approver),
      submitter: submitter ?? null,
      approver: approver ?? null,
      ready: contracts.length > 0 && contracts.every((c) => c.submitterOk && c.approverOk),
      contracts,
      events,
      issues,
    });
  }

  /** Grants (or revokes) the autopilot's minimal roles on the AuditRegistry and every project distributor, as one Safe batch. */
  @Post("roles")
  @Roles("GOV_VIEW", "OPERATOR")
  async roles(@Req() req: AuthedRequest, @Body(new ZodPipe(rolesBody)) body: z.infer<typeof rolesBody>) {
    const { submitter, approver } = this.wallets(true);
    const fn = body.action === "grant" ? "grantRole" : "revokeRole";
    const calls: (Call & { description: string })[] = [];
    for (const t of await this.targets()) {
      const abi = (t.kind === "AUDIT_REGISTRY" ? auditRegistryAbi : revenueDistributorAbi) as Abi;
      calls.push({ ...call(t.address, abi, fn, [OPERATOR_ROLE, submitter]), description: `${fn} OPERATOR_ROLE to autopilot submitter on ${t.label}` });
      calls.push({ ...call(t.address, abi, fn, [REVIEWER_ROLE, approver]), description: `${fn} REVIEWER_ROLE to autopilot approver on ${t.label}` });
    }
    if (!calls.length) throw new ApiError(409, "CONFLICT", "no contracts to grant on yet");
    const safe = this.cfg.safe;
    if (!safe) throw new ApiError(503, "CHAIN_UNAVAILABLE", "SAFE is not configured");
    const proposal = await queueSafe(this.prisma, viaSafe(this.cfg.chainId, safe, calls, `autopilot roles ${body.action}`), req.session!.wallet);
    await this.prisma.adminAction.create({
      data: { userId: req.session!.userId, wallet: req.session!.wallet, action: `AUTOPILOT_ROLES_${body.action.toUpperCase()}`, targetType: "autopilot", targetId: "roles", payloadHash: keccak256(stringToHex(canonicalJson(body))) },
    });
    return plain({ proposal });
  }

  // ------------------------------------------------------------ daily operating data

  @Get("daily/:projectId")
  @Roles("OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW")
  async daily(@Param("projectId") projectId: string, @Query("month") month?: string) {
    const m = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : beijingToday().slice(0, 7);
    const start = new Date(`${m}-01T00:00:00Z`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const items = await this.prisma.dailyOperating.findMany({ where: { projectIdOnchain: projectId, day: { gte: start, lt: end } }, orderBy: { day: "asc" } });
    const sum = (k: "revenue" | "expenses") => items.reduce((s, i) => s + BigInt(i[k].toFixed()), 0n);
    return plain({ month: m, items, totals: { revenue: sum("revenue"), expenses: sum("expenses"), days: items.length } });
  }

  /** Enter or correct one day. Days already covered by an approved monthly report are locked. */
  @Put("daily/:projectId")
  @Roles("OPERATOR")
  async putDaily(@Req() req: AuthedRequest, @Param("projectId") projectId: string, @Body(new ZodPipe(dailyBody)) body: z.infer<typeof dailyBody>) {
    const project = await this.prisma.project.findUnique({ where: { projectIdOnchain: projectId } });
    if (!project) throw notFound("project");
    if (!["ACTIVE", "EXIT_PENDING", "SUSPENDED"].includes(project.state)) throw new ApiError(409, "PROJECT_STATE_INVALID", `project is ${project.state}`);
    if (body.day > beijingToday()) throw new ApiError(400, "VALIDATION_FAILED", "day is in the future");
    const day = new Date(`${body.day}T00:00:00Z`);
    const locked = await this.prisma.financialReport.findFirst({
      where: { projectIdOnchain: projectId, status: { in: ["SUBMITTED", "APPROVED"] }, periodStart: { lte: day }, periodEnd: { gt: day } },
    });
    if (locked) throw new ApiError(409, "PERIOD_ALREADY_APPROVED", "this day is already in a submitted monthly report");
    const data = { revenue: body.revenue, expenses: body.expenses, rides: body.rides ?? null, note: body.note ?? null, enteredBy: lc(req.session!.wallet) };
    const row = await this.prisma.dailyOperating.upsert({
      where: { projectIdOnchain_day: { projectIdOnchain: projectId, day } },
      create: { projectIdOnchain: projectId, day, ...data },
      update: data,
    });
    await this.prisma.adminAction.create({
      data: { userId: req.session!.userId, wallet: req.session!.wallet, action: "DAILY_OPERATING_PUT", targetType: "project", targetId: projectId, payloadHash: keccak256(stringToHex(canonicalJson(body))) },
    });
    return plain(row);
  }

  private wallets(required: true): { submitter: Address; approver: Address };
  private wallets(required: false): { submitter?: Address; approver?: Address };
  private wallets(required: boolean) {
    const { autopilotSubmitter: submitter, autopilotApprover: approver } = this.cfg;
    if (required && (!submitter || !approver)) throw new ApiError(503, "CHAIN_UNAVAILABLE", "AUTOPILOT_SUBMITTER / AUTOPILOT_APPROVER are not configured");
    return { submitter, approver };
  }

  /** The AuditRegistry plus the distributor of every project that has one. */
  private async targets(): Promise<{ kind: string; label: string; address: Address }[]> {
    const out: { kind: string; label: string; address: Address }[] = [];
    if (this.cfg.auditRegistry) out.push({ kind: "AUDIT_REGISTRY", label: "AuditRegistry", address: this.cfg.auditRegistry });
    const projects = await this.prisma.project.findMany({ where: { distributorAddress: { not: null } }, orderBy: { registeredBlock: "asc" } });
    const metas = await this.prisma.projectMeta.findMany({ where: { projectIdOnchain: { in: projects.map((p) => p.projectIdOnchain) } } });
    for (const p of projects) {
      const m = metas.find((x) => x.projectIdOnchain === p.projectIdOnchain);
      out.push({ kind: "DISTRIBUTOR", label: m?.title ?? m?.slug ?? p.projectIdOnchain.slice(0, 10), address: getAddress(p.distributorAddress!) });
    }
    return out;
  }
}
