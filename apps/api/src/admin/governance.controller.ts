import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import {
  assetRegistryAbi,
  canonicalJson,
  identityRegistryAbi,
  offeringManagerAbi,
  PROJECT_STATES,
  revenueDistributorAbi,
  rwaShareTokenAbi,
  SHARE_CAP,
  subscriptionRouterAbi,
} from "@roboshare/shared";
import type { Response } from "express";
import { getAddress, isAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { Roles, RoleGuard, type AuthedRequest } from "../auth/guards.js";
import { ApiError, notFound } from "../common/errors.js";
import { IdempotencyInterceptor } from "../common/idempotency.js";
import { PrismaService } from "../common/prisma.service.js";
import { lc, plain } from "../common/serialize.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { call, prepare, viaTimelock } from "./prepare.js";

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().refine((v) => isAddress(v), "invalid address");
const reason = z.string().min(3).max(500);

const offeringBody = z
  .object({
    unitPrice: z.string().regex(/^[1-9][0-9]*$/),
    minUnits: z.number().int().min(1).max(SHARE_CAP),
    perWalletMax: z.number().int().min(1).max(SHARE_CAP).default(SHARE_CAP), // default: no per-wallet cap
    startTime: z.number().int().positive(),
    endTime: z.number().int().positive(),
    treasury: address,
    termsHash: bytes32,
  })
  .refine((o) => o.startTime < o.endTime, { message: "startTime must be before endTime", path: ["endTime"] })
  .refine((o) => o.endTime > Date.now() / 1000, { message: "endTime must be in the future", path: ["endTime"] });

const transitionBody = z.object({ to: z.enum(PROJECT_STATES), reason });
const excludeBody = z.object({ wallet: address, reason });
const pauseBody = z.object({ scope: z.enum(["platform", "project"]), projectId: bytes32.optional(), reason });

/** States a REVIEWER moves directly; every other transition goes through the timelock (AssetRegistry._authorizeTransition). */
const REVIEWER_DIRECT = new Set(["VERIFIED", "DRAFT"]);

@Controller("admin")
@UseGuards(RoleGuard)
@UseInterceptors(IdempotencyInterceptor)
export class GovernanceController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Post("projects/:id/offering")
  @Roles("GOV_VIEW")
  async offering(@Req() req: AuthedRequest, @Param("id") id: string, @Body(new ZodPipe(offeringBody)) body: z.infer<typeof offeringBody>) {
    const p = await this.project(id);
    if (p.state !== "VERIFIED" || !p.offeringAddress) throw new ApiError(409, "PROJECT_STATE_INVALID", `project is ${p.state}`);
    const cfg = {
      unitPrice: BigInt(body.unitPrice),
      minUnits: body.minUnits,
      maxUnits: SHARE_CAP, // OfferingManager requires maxUnits == CAP
      perWalletMax: body.perWalletMax,
      startTime: BigInt(body.startTime),
      endTime: BigInt(body.endTime),
      treasury: getAddress(body.treasury),
      termsHash: body.termsHash as Hex,
    };
    const offering = getAddress(p.offeringAddress);
    const proposal = viaTimelock(this.cfg.chainId, this.timelock(), this.cfg.timelockDelaySeconds, [
      call(offering, offeringManagerAbi, "configure", [cfg]),
      call(offering, offeringManagerAbi, "open", []),
    ], `configure and open offering ${id}`);
    await this.audit(req, "OFFERING_PROPOSE", "project", id, body);
    return plain({ proposal });
  }

  @Post("offerings/:id/settle")
  @Roles("OPERATOR")
  @HttpCode(200)
  async settle(@Req() req: AuthedRequest, @Param("id") id: string) {
    const p = await this.project(id);
    const offering = await this.prisma.offering.findUnique({ where: { projectIdOnchain: id }, include: { subscriptions: true } });
    if (!offering || offering.status !== "OPEN") throw new ApiError(409, "OFFERING_CLOSED", "offering is not open");
    if (offering.unitsSold < offering.minUnits) {
      throw new ApiError(409, "OFFERING_CLOSED", `only ${offering.unitsSold} of the minimum ${offering.minUnits} units sold`);
    }
    // settle() reverts if any escrowed subscriber is no longer eligible; check first so staff can exclude them.
    const escrowed = offering.subscriptions.filter((s) => s.status === "ESCROWED");
    const elig = await this.prisma.eligibility.findMany({ where: { wallet: { in: escrowed.map((s) => s.wallet) } } });
    const ok = new Set(elig.filter((e) => e.status === "ELIGIBLE" && (!e.expiresAt || e.expiresAt.getTime() > Date.now())).map((e) => e.wallet));
    const blocked = escrowed.filter((s) => !ok.has(s.wallet)).map((s) => getAddress(s.wallet));
    if (blocked.length) throw new ApiError(409, "NOT_ELIGIBLE", "some subscribers are no longer eligible; exclude them first", { wallets: blocked });
    await this.audit(req, "OFFERING_SETTLE_PREPARE", "project", id, {});
    return { tx: prepare(this.cfg.chainId, getAddress(p.offeringAddress!), offeringManagerAbi, "settle", [], "Settle the offering (operator wallet)") };
  }

  @Post("offerings/:id/exclude")
  @Roles("GOV_VIEW")
  async exclude(@Req() req: AuthedRequest, @Param("id") id: string, @Body(new ZodPipe(excludeBody)) body: z.infer<typeof excludeBody>) {
    const p = await this.project(id);
    const sub = await this.prisma.subscription.findUnique({ where: { projectIdOnchain_wallet: { projectIdOnchain: id, wallet: lc(body.wallet) } } });
    if (!sub || sub.status !== "ESCROWED") throw notFound("escrowed subscription");
    const proposal = viaTimelock(this.cfg.chainId, this.timelock(), this.cfg.timelockDelaySeconds, [
      call(getAddress(p.offeringAddress!), offeringManagerAbi, "excludeSubscriber", [getAddress(body.wallet), keccak256(stringToHex(body.reason))]),
    ], `exclude ${body.wallet} from offering ${id}`);
    await this.audit(req, "OFFERING_EXCLUDE_PROPOSE", "project", id, body);
    return plain({ proposal });
  }

  @Post("projects/:id/transition")
  @Roles("REVIEWER", "GOV_VIEW")
  async transition(@Req() req: AuthedRequest, @Param("id") id: string, @Body(new ZodPipe(transitionBody)) body: z.infer<typeof transitionBody>) {
    await this.project(id);
    const registry = this.need(this.cfg.assetRegistry, "ASSET_REGISTRY");
    const args = [id, PROJECT_STATES.indexOf(body.to), keccak256(stringToHex(body.reason))];
    await this.audit(req, `PROJECT_TRANSITION_${body.to}`, "project", id, body);
    if (REVIEWER_DIRECT.has(body.to) && req.staffRoles?.includes("REVIEWER")) {
      return { tx: prepare(this.cfg.chainId, registry, assetRegistryAbi, "transition", args, `Move project to ${body.to} (reviewer wallet, not the registrant)`) };
    }
    const proposal = viaTimelock(this.cfg.chainId, this.timelock(), this.cfg.timelockDelaySeconds, [call(registry, assetRegistryAbi, "transition", args)], `move project ${id} to ${body.to}`);
    return plain({ proposal });
  }

  /** Emergency pause, prepared for the Guardian (PAUSER) Safe. Pausing never waits for the timelock. */
  @Post("pause")
  @Roles("GOV_VIEW")
  async pause(@Req() req: AuthedRequest, @Body(new ZodPipe(pauseBody)) body: z.infer<typeof pauseBody>) {
    const txs = [];
    if (body.scope === "platform") {
      const router = (await this.prisma.contractDeployment.findFirst({ where: { chainId: this.cfg.chainId, kind: "SUBSCRIPTION_ROUTER" } }))?.address;
      const identity = (await this.prisma.contractDeployment.findFirst({ where: { chainId: this.cfg.chainId, kind: "IDENTITY_REGISTRY" } }))?.address;
      if (!router || !identity) throw new ApiError(503, "CHAIN_UNAVAILABLE", "contracts not indexed yet");
      txs.push(prepare(this.cfg.chainId, getAddress(router), subscriptionRouterAbi, "pause", [], "Pause all new subscriptions"));
      txs.push(prepare(this.cfg.chainId, getAddress(identity), identityRegistryAbi, "pause", [], "Pause eligibility changes"));
    } else {
      if (!body.projectId) throw new ApiError(400, "VALIDATION_FAILED", "projectId is required for scope=project");
      const p = await this.project(body.projectId);
      if (!p.tokenAddress) throw new ApiError(409, "PROJECT_STATE_INVALID", "project has no contracts yet");
      txs.push(prepare(this.cfg.chainId, getAddress(p.tokenAddress), rwaShareTokenAbi, "pause", [], "Pause share transfers"));
      txs.push(prepare(this.cfg.chainId, getAddress(p.offeringAddress!), offeringManagerAbi, "pause", [], "Pause subscriptions, settlement and refunds"));
      txs.push(prepare(this.cfg.chainId, getAddress(p.distributorAddress!), revenueDistributorAbi, "pause", [], "Pause distributions and claims (D-21)"));
    }
    await this.audit(req, "PAUSE_PREPARE", body.scope, body.projectId ?? "platform", body);
    return { signer: "Guardian Safe (PAUSER_ROLE)", txs };
  }

  @Get("exports/:kind")
  @Roles("OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW")
  async export(@Param("kind") kind: string, @Query("projectId") projectId: string, @Res() res: Response) {
    if (!projectId) throw new ApiError(400, "VALIDATION_FAILED", "projectId is required");
    let header: string[];
    let rows: (string | number)[][];
    if (kind === "holdings") {
      const hs = await this.prisma.holding.findMany({ where: { projectIdOnchain: projectId }, orderBy: { wallet: "asc" } });
      header = ["wallet", "units", "last_block"];
      rows = hs.map((h) => [h.wallet, h.units, h.lastBlock.toString()]);
    } else if (kind === "distributions") {
      const as = await this.prisma.distributionAllocation.findMany({ where: { projectIdOnchain: projectId }, orderBy: [{ batchIdOnchain: "asc" }, { wallet: "asc" }] });
      header = ["batch_id", "wallet", "units", "gross", "fee_bps", "net", "claimed", "claim_tx"];
      rows = as.map((a) => [a.batchIdOnchain, a.wallet, a.units, a.gross.toFixed(), a.feeBps, a.net.toFixed(), String(a.claimed), a.claimTxHash ?? ""]);
    } else if (kind === "reports") {
      const rs = await this.prisma.financialReport.findMany({ where: { projectIdOnchain: projectId }, orderBy: { periodStart: "asc" } });
      header = ["id", "period_start", "period_end", "status", "gross_revenue", "total_expenses", "total_reserves", "distributable", "hash", "record_id"];
      rows = rs.map((r) => [r.id, r.periodStart.toISOString().slice(0, 10), r.periodEnd.toISOString().slice(0, 10), r.status, r.grossRevenue.toFixed(), r.totalExpenses.toFixed(), r.totalReserves.toFixed(), r.distributableAmount.toFixed(), r.canonicalHash, r.recordIdOnchain ?? ""]);
    } else {
      throw notFound("export kind");
    }
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${kind}-${projectId.slice(0, 10)}.csv"`);
    res.send(csv);
  }

  private async project(id: string) {
    const p = await this.prisma.project.findUnique({ where: { projectIdOnchain: id } }).catch(() => null);
    if (!p) throw notFound("project");
    return p;
  }

  private timelock(): Address {
    return this.need(this.cfg.timelock, "TIMELOCK");
  }

  private need(addr: Address | undefined, name: string): Address {
    if (!addr) throw new ApiError(503, "CHAIN_UNAVAILABLE", `${name} is not configured`);
    return addr;
  }

  private async audit(req: AuthedRequest, action: string, targetType: string, targetId: string, payload: unknown) {
    await this.prisma.adminAction.create({
      data: { userId: req.session!.userId, wallet: req.session!.wallet, action, targetType, targetId, payloadHash: keccak256(stringToHex(canonicalJson(payload))) },
    });
  }
}

/** Quotes every cell and neutralises spreadsheet formulas (CSV injection). */
function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
