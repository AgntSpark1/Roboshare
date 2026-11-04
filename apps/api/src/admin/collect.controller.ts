import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import {
  canonicalJson,
  offeringManagerAbi,
  referralRewardsAbi,
  revenueDistributorAbi,
  shareMarketAbi,
  subscriptionRouterAbi,
} from "@roboshare/shared";
import { getAddress, isAddress, keccak256, stringToHex, type Address } from "viem";
import { z } from "zod";
import { Roles, RoleGuard, type AuthedRequest } from "../auth/guards.js";
import { ApiError } from "../common/errors.js";
import { IdempotencyInterceptor } from "../common/idempotency.js";
import { PrismaService } from "../common/prisma.service.js";
import { plain } from "../common/serialize.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { call, queueSafe, viaSafe } from "./prepare.js";

const ALL_STAFF = ["OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW"] as const;
const address = z.string().refine((v) => isAddress(v), "invalid address");
const reason = z.string().min(3).max(500);
const projectId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
/** One pull call per wallet inside one Safe batch; a MultiSend batch stays well under gas limits. */
const MAX_PULL_WALLETS = 200;
const MAX_SWEEP_PROJECTS = 50;

const pullBody = z.object({
  /** The recovery wallet the collected USDT lands in (e.g. a treasury Safe). */
  to: address,
  /** Which contract's allowance to collect: the subscription router or the resale market. */
  source: z.enum(["router", "market"]),
  froms: z.array(address).min(1).max(MAX_PULL_WALLETS),
  reason,
});

const sweepBody = z
  .object({
    to: address,
    router: z.boolean().default(false),
    market: z.boolean().default(false),
    referral: z.boolean().default(false),
    projectIds: z.array(projectId).max(MAX_SWEEP_PROJECTS).default([]),
    reason,
  })
  .refine((b) => b.router || b.market || b.referral || b.projectIds.length > 0, {
    message: "select at least one pool to sweep",
  });

/**
 * USDT 归集 (collect) levers for the console (SECURITY_MODEL.md, 2026-11-02): governance can pull
 * the USDT investor wallets still allow the router/market to spend, and sweep every USDT-holding
 * contract's balance into one recovery address. Everything is prepared as a Safe proposal and
 * queued for owners; nothing is signed or sent here.
 */
@Controller("admin")
@UseGuards(RoleGuard)
@UseInterceptors(IdempotencyInterceptor)
export class CollectController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Wallets known to have subscribed (the D-23 approve-once flow), as candidates for a pull. */
  @Get("collect/wallets")
  @Roles(...ALL_STAFF)
  async wallets() {
    const grouped = await this.prisma.subscription.groupBy({
      by: ["wallet"],
      _count: { wallet: true },
      _sum: { units: true },
    });
    const items = grouped
      .map((g) => ({ wallet: getAddress(g.wallet), subscriptions: g._count.wallet, units: g._sum.units ?? 0 }))
      .sort((a, b) => b.units - a.units || a.wallet.localeCompare(b.wallet));
    return plain({ items });
  }

  /**
   * Prepares the wallet collect: one `pullUsdt(from, to)` per wallet, batched into a single Safe
   * transaction (MultiSendCallOnly). Takes min(allowance, balance) per wallet on execution.
   */
  @Post("collect/pull")
  @Roles("GOV_VIEW")
  async pull(@Req() req: AuthedRequest, @Body(new ZodPipe(pullBody)) body: z.infer<typeof pullBody>) {
    const to = getAddress(body.to);
    const unique = [...new Set(body.froms.map((w) => w.toLowerCase()))];
    if (unique.length !== body.froms.length) throw new ApiError(400, "VALIDATION_FAILED", "duplicate wallet in froms");
    const target =
      body.source === "router" ? await this.deployed("SUBSCRIPTION_ROUTER") : await this.deployed("SHARE_MARKET");
    const abi = body.source === "router" ? subscriptionRouterAbi : shareMarketAbi;
    const label = body.source === "router" ? "subscription router" : "resale market";
    const calls = unique.map((w) => call(target, abi, "pullUsdt", [getAddress(w), to]));
    const proposal = await queueSafe(this.prisma, viaSafe(this.cfg.chainId, this.safe(), calls, `pull USDT from ${unique.length} wallet(s) approved to the ${label}`), req.session!.wallet);
    await this.audit(req, "COLLECT_PULL_PROPOSE", "collect", body.source, { ...body, count: unique.length });
    return plain({ proposal });
  }

  /**
   * Prepares the pool collect: `sweepUsdt(to)` on the selected platform contracts and on each
   * selected project's offering escrow and distributor, batched into one Safe transaction.
   */
  @Post("collect/sweep")
  @Roles("GOV_VIEW")
  async sweep(@Req() req: AuthedRequest, @Body(new ZodPipe(sweepBody)) body: z.infer<typeof sweepBody>) {
    const to = getAddress(body.to);
    const calls: ReturnType<typeof call>[] = [];
    const picked: string[] = [];
    if (body.router) {
      const router = await this.deployed("SUBSCRIPTION_ROUTER");
      calls.push(call(router, subscriptionRouterAbi, "sweepUsdt", [to]));
      picked.push("router");
    }
    if (body.market) {
      const market = await this.deployed("SHARE_MARKET");
      calls.push(call(market, shareMarketAbi, "sweepUsdt", [to]));
      picked.push("market");
    }
    if (body.referral) {
      const referral = await this.deployed("REFERRAL_REWARDS");
      calls.push(call(referral, referralRewardsAbi, "sweepUsdt", [to]));
      picked.push("referral");
    }
    for (const id of body.projectIds) {
      const p = await this.prisma.project.findUnique({ where: { projectIdOnchain: id } }).catch(() => null);
      if (!p) throw new ApiError(404, "NOT_FOUND", `project ${id} not found`);
      if (p.offeringAddress) {
        calls.push(call(getAddress(p.offeringAddress), offeringManagerAbi, "sweepUsdt", [to]));
        picked.push(`offering:${id.slice(0, 10)}`);
      }
      if (p.distributorAddress) {
        calls.push(call(getAddress(p.distributorAddress), revenueDistributorAbi, "sweepUsdt", [to]));
        picked.push(`distributor:${id.slice(0, 10)}`);
      }
      if (!p.offeringAddress && !p.distributorAddress) {
        throw new ApiError(409, "PROJECT_STATE_INVALID", `project ${id} has no contracts yet`);
      }
    }
    const proposal = await queueSafe(this.prisma, viaSafe(this.cfg.chainId, this.safe(), calls, `sweep USDT from ${picked.length} pool(s) into the recovery wallet`), req.session!.wallet);
    await this.audit(req, "COLLECT_SWEEP_PROPOSE", "collect", picked.join(","), { ...body, pools: picked });
    return plain({ proposal });
  }

  // ------------------------------------------------------------ helpers

  private async deployed(kind: string): Promise<Address> {
    // Order matters: a testnet redeploy adds a second row for the same kind (the old contracts stay
    // in the table), and the collect levers must target the newest deployment.
    const row = await this.prisma.contractDeployment.findFirst({
      where: { chainId: this.cfg.chainId, kind },
      orderBy: { deployedBlock: "desc" },
    });
    if (!row) throw new ApiError(503, "CHAIN_UNAVAILABLE", `${kind} is not indexed yet`);
    return getAddress(row.address);
  }

  private safe(): Address {
    if (!this.cfg.safe) throw new ApiError(503, "CHAIN_UNAVAILABLE", "SAFE is not configured");
    return this.cfg.safe;
  }

  private async audit(req: AuthedRequest, action: string, targetType: string, targetId: string, payload: unknown) {
    await this.prisma.adminAction.create({
      data: { userId: req.session!.userId, wallet: req.session!.wallet, action, targetType, targetId, payloadHash: keccak256(stringToHex(canonicalJson(payload))) },
    });
  }
}
