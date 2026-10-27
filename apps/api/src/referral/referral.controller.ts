import { Body, Controller, Get, Inject, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { Prisma } from "@roboshare/db";
import {
  buildReferralTree,
  canonicalJson,
  referralRewardsAbi,
  REFERRAL_DEFAULT_SHARE_BPS,
  REFERRAL_LEVEL_BPS,
  subscriptionRouterAbi,
  verifyReferralProof,
} from "@roboshare/shared";
import { getAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { InvestorGuard, Roles, RoleGuard, type AuthedRequest } from "../auth/guards.js";
import { ApiError } from "../common/errors.js";
import { IdempotencyInterceptor } from "../common/idempotency.js";
import { PrismaService } from "../common/prisma.service.js";
import { plain } from "../common/serialize.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { call, prepare, queueSafe, viaSafe } from "../admin/prepare.js";

interface TreeEntry {
  account: Address;
  cumulative: string;
  proof: Hex[];
}

const dec = (d: Prisma.Decimal | null | undefined) => BigInt(d ? d.toFixed() : "0");

async function contractOf(prisma: PrismaService, chainId: number, kind: string): Promise<Address | null> {
  const row = await prisma.contractDeployment.findFirst({ where: { chainId, kind } });
  return row ? getAddress(row.address) : null;
}

/** Investor view of the three-level referral programme (REFERRAL_DESIGN.md §10). */
@Controller("me")
@UseGuards(InvestorGuard)
export class MeReferralController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get("referrals")
  async referrals(@Req() req: AuthedRequest) {
    const wallet = req.session!.wallet;
    const [mine, referees, accruals, claim, latestRoot] = await Promise.all([
      this.prisma.referral.findUnique({ where: { referee: wallet } }),
      this.prisma.referral.findMany({ where: { referrer: wallet }, orderBy: { boundBlock: "asc" } }),
      this.prisma.referralAccrual.groupBy({ by: ["referee", "level"], where: { referrer: wallet }, _sum: { reward: true } }),
      this.prisma.referralClaim.findUnique({ where: { account: wallet } }),
      this.prisma.referralRoot.findFirst({ orderBy: { epoch: "desc" } }),
    ]);
    // Second and third level: people your direct referrals invited, and the people they invited.
    // Nothing deeper is tracked or paid.
    const second = await this.prisma.referral.findMany({
      where: { referrer: { in: referees.map((r) => r.referee) } },
      orderBy: { boundBlock: "asc" },
    });
    const third = await this.prisma.referral.findMany({
      where: { referrer: { in: second.map((r) => r.referee) } },
      orderBy: { boundBlock: "asc" },
    });
    const [blocks, history] = await Promise.all([
      this.prisma.chainBlock.findMany({ where: { chainId: this.cfg.chainId, number: { in: [...referees, ...second, ...third].map((r) => r.boundBlock) } } }),
      this.prisma.referralAccrual.findMany({
        where: { referrer: wallet },
        orderBy: [{ projectIdOnchain: "asc" }, { batchIdOnchain: "desc" }, { level: "asc" }],
        take: 100,
      }),
    ]);
    const boundAt = new Map(blocks.map((b) => [b.number, b.timestamp]));
    const titles = new Map(
      (await this.prisma.projectMeta.findMany({ where: { projectIdOnchain: { in: [...new Set(history.map((h) => h.projectIdOnchain))] } } })).map((m) => [m.projectIdOnchain, m.title]),
    );
    const earnedBy = new Map(accruals.map((a) => [`${a.level}:${a.referee}`, dec(a._sum.reward)]));
    const earned = [...earnedBy.values()].reduce((s, x) => s + x, 0n);
    const member = (level: number) => (r: (typeof referees)[number]) => ({
      wallet: getAddress(r.referee),
      shareBps: REFERRAL_LEVEL_BPS[level - 1]!,
      expiresAt: r.expiresAt,
      boundAt: boundAt.get(r.boundBlock) ?? null,
      active: r.expiresAt.getTime() > Date.now(),
      earned: (earnedBy.get(`${level}:${r.referee}`) ?? 0n).toString(),
      ...(level > 1 ? { via: getAddress(r.referrer) } : {}),
    });
    const claimed = dec(claim?.claimed);

    // A proof is only served for the root that is live on chain, and only after checking it.
    let claimable: { cumulative: string; amount: string; proof: Hex[]; epoch: number } | null = null;
    if (latestRoot) {
      const tree = await this.prisma.referralTree.findUnique({ where: { root: latestRoot.root } });
      const entry = (tree?.entries as TreeEntry[] | undefined)?.find((e) => e.account.toLowerCase() === wallet);
      if (entry && verifyReferralProof(latestRoot.root as Hex, entry.account, BigInt(entry.cumulative), entry.proof)) {
        const amount = BigInt(entry.cumulative) - claimed;
        if (amount > 0n) claimable = { cumulative: entry.cumulative, amount: amount.toString(), proof: entry.proof, epoch: latestRoot.epoch };
      }
    }
    return plain({
      wallet: getAddress(wallet),
      contract: await contractOf(this.prisma, this.cfg.chainId, "REFERRAL_REWARDS"),
      referredBy: mine ? { referrer: getAddress(mine.referrer), shareBps: mine.shareBps, expiresAt: mine.expiresAt } : null,
      levelBps: REFERRAL_LEVEL_BPS,
      referees: referees.map(member(1)),
      level2: second.map(member(2)),
      level3: third.map(member(3)),
      // Most recent first within each project: one row per referee allocation that earned a reward.
      history: history.map((h) => ({
        projectId: h.projectIdOnchain,
        projectTitle: titles.get(h.projectIdOnchain) ?? null,
        batchId: h.batchIdOnchain,
        referee: getAddress(h.referee),
        level: h.level,
        gross: h.gross,
        fee: h.fee,
        shareBps: h.shareBps,
        reward: h.reward,
      })),
      // earned counts every accrual; only amounts in a published root can be claimed yet.
      earned: earned.toString(),
      claimed: claimed.toString(),
      pendingPublication: (earned - (claimable ? BigInt(claimable.cumulative) : claimed)).toString(),
      claimable,
    });
  }
}

const termsBody = z.object({
  enabled: z.boolean(),
  windowDays: z.number().int().min(1).max(3_650),
});

@Controller("admin/referrals")
@UseGuards(RoleGuard)
@UseInterceptors(IdempotencyInterceptor)
export class AdminReferralController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get()
  @Roles("OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW")
  async summary() {
    const [bindings, accrued, latestRoot, claimed, referrers] = await Promise.all([
      this.prisma.referral.count(),
      this.prisma.referralAccrual.aggregate({ _sum: { reward: true, fee: true } }),
      this.prisma.referralRoot.findFirst({ orderBy: { epoch: "desc" } }),
      this.prisma.referralClaim.aggregate({ _sum: { claimed: true } }),
      this.prisma.referralAccrual.groupBy({ by: ["referrer"], _sum: { reward: true }, orderBy: { _sum: { reward: "desc" } }, take: 50 }),
    ]);
    const published = dec(latestRoot?.totalCumulative);
    const totalClaimed = dec(claimed._sum.claimed);
    return plain({
      contract: await contractOf(this.prisma, this.cfg.chainId, "REFERRAL_REWARDS"),
      bindings,
      totalFee: dec(accrued._sum.fee).toString(),
      totalAccrued: dec(accrued._sum.reward).toString(),
      latestRoot,
      totalPublished: published.toString(),
      totalClaimed: totalClaimed.toString(),
      // The contract must hold at least this much for every published reward to be claimable.
      outstanding: (published - totalClaimed).toString(),
      topReferrers: referrers.map((r) => ({ referrer: getAddress(r.referrer), accrued: dec(r._sum.reward).toString() })),
    });
  }

  /**
   * Builds a tree of every referrer's cumulative accrued reward and prepares setRoot for the
   * operator wallet. The tree is stored so investors can fetch proofs once the root is on chain.
   */
  @Post("root")
  @Roles("OPERATOR")
  async prepareRoot(@Req() req: AuthedRequest) {
    const rewards = await contractOf(this.prisma, this.cfg.chainId, "REFERRAL_REWARDS");
    if (!rewards) throw new ApiError(503, "CHAIN_UNAVAILABLE", "REFERRAL_REWARDS is not indexed");
    const sums = await this.prisma.referralAccrual.groupBy({ by: ["referrer"], _sum: { reward: true } });
    const input = sums.map((s) => ({ account: getAddress(s.referrer), cumulative: dec(s._sum.reward) })).filter((e) => e.cumulative > 0n);
    if (input.length === 0) throw new ApiError(409, "NOTHING_TO_PUBLISH", "no referral rewards have accrued");
    const latest = await this.prisma.referralRoot.findFirst({ orderBy: { epoch: "desc" } });
    const tree = buildReferralTree(input);
    if (latest && latest.root === tree.root) throw new ApiError(409, "NOTHING_TO_PUBLISH", "the live root already covers every accrual");

    const entries: TreeEntry[] = tree.entries.map((e) => ({ account: e.account, cumulative: e.cumulative.toString(), proof: e.proof }));
    const dataHash = keccak256(stringToHex(canonicalJson(entries)));
    await this.prisma.referralTree.upsert({
      where: { root: tree.root },
      create: { root: tree.root, dataHash, totalCumulative: tree.totalCumulative.toString(), entries: entries as unknown as Prisma.InputJsonValue, createdByUserId: req.session!.userId },
      update: {},
    });
    await this.audit(req, "REFERRAL_ROOT_PREPARE", "referral_tree", tree.root, { dataHash, total: tree.totalCumulative.toString() });
    const outstanding = tree.totalCumulative - dec((await this.prisma.referralClaim.aggregate({ _sum: { claimed: true } }))._sum.claimed);
    return plain({
      root: tree.root,
      dataHash,
      accounts: entries.length,
      totalCumulative: tree.totalCumulative,
      /** USDT the platform fee wallet must have sent to the contract before claims can all succeed. */
      requiredBalance: outstanding,
      tx: prepare(this.cfg.chainId, rewards, referralRewardsAbi, "setRoot", [tree.root, dataHash, tree.totalCumulative], "Publish the referral reward root (operator wallet)"),
    });
  }

  /** Governance switch for both contracts, as one Safe batch (effective once two owners sign). Off by default. */
  @Post("terms")
  @Roles("GOV_VIEW")
  async terms(@Req() req: AuthedRequest, @Body(new ZodPipe(termsBody)) body: z.infer<typeof termsBody>) {
    const safe = this.cfg.safe;
    if (!safe) throw new ApiError(503, "CHAIN_UNAVAILABLE", "SAFE is not configured");
    const router = await contractOf(this.prisma, this.cfg.chainId, "SUBSCRIPTION_ROUTER");
    const rewards = await contractOf(this.prisma, this.cfg.chainId, "REFERRAL_REWARDS");
    if (!router || !rewards) throw new ApiError(503, "CHAIN_UNAVAILABLE", "referral contracts are not indexed");
    const calls = [
      // The router records shareBps on each binding; amounts follow REFERRAL_LEVEL_BPS in code (§10).
      call(router, subscriptionRouterAbi, "setReferralTerms", [body.enabled, REFERRAL_DEFAULT_SHARE_BPS, BigInt(body.windowDays) * 86_400n]),
      call(rewards, referralRewardsAbi, "setClaimsEnabled", [body.enabled]),
    ];
    await this.audit(req, "REFERRAL_TERMS_PREPARE", "referral", "terms", body);
    return queueSafe(this.prisma, viaSafe(this.cfg.chainId, safe, calls, `referral terms ${body.enabled ? "on" : "off"}`), req.session!.wallet);
  }

  private async audit(req: AuthedRequest, action: string, targetType: string, targetId: string, payload: unknown) {
    await this.prisma.adminAction.create({
      data: { userId: req.session!.userId, wallet: req.session!.wallet, action, targetType, targetId, payloadHash: keccak256(stringToHex(canonicalJson(payload))) },
    });
  }
}
