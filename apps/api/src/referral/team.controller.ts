import { Body, Controller, Get, Inject, Param, Post, Put, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { Prisma, type Team } from "@roboshare/db";
import { canonicalJson, normalizeTeamCode, placeInTeams, type TeamPlacement } from "@roboshare/shared";
import { getAddress, isAddress, keccak256, stringToHex } from "viem";
import { z } from "zod";
import { InvestorGuard, Roles, RoleGuard, type AuthedRequest } from "../auth/guards.js";
import { ApiError, notFound } from "../common/errors.js";
import { IdempotencyInterceptor } from "../common/idempotency.js";
import { PrismaService } from "../common/prisma.service.js";
import { lc, plain } from "../common/serialize.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";

const dec = (d: Prisma.Decimal | null | undefined) => BigInt(d ? d.toFixed() : "0");
/** Subscriptions that are still invested (escrowed or settled into units), not refunds. */
const LIVE = { in: ["ESCROWED", "SETTLED"] as ("ESCROWED" | "SETTLED")[] };

/**
 * Promotion teams (REFERRAL_DESIGN.md §9). Teams only group wallets for reporting: rewards stay the
 * two-level referral rewards, settled from one treasury through ReferralRewards.
 */
class Teams {
  constructor(private readonly prisma: PrismaService, private readonly chainId: number) {}

  async placement() {
    const [teams, bindings] = await Promise.all([
      this.prisma.team.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.referral.findMany({ select: { referee: true, referrer: true, boundBlock: true } }),
    ]);
    const referrerOf = new Map(bindings.map((b) => [b.referee, b.referrer]));
    const placed = placeInTeams(referrerOf, new Set(teams.map((t) => t.leader)));
    return { teams, bindings, referrerOf, placed };
  }

  /** Totals per member wallet: invested USDT, referral rewards earned, platform fee their own holdings produced. */
  async stats(wallets: string[]) {
    const [subs, earned, fees] = await Promise.all([
      this.prisma.subscription.groupBy({ by: ["wallet"], where: { wallet: { in: wallets }, status: LIVE }, _sum: { amount: true } }),
      this.prisma.referralAccrual.groupBy({ by: ["referrer"], where: { referrer: { in: wallets } }, _sum: { reward: true } }),
      this.prisma.referralAccrual.groupBy({ by: ["referee"], where: { referee: { in: wallets }, level: 1 }, _sum: { fee: true } }),
    ]);
    return {
      invested: new Map(subs.map((s) => [s.wallet, dec(s._sum.amount)])),
      earned: new Map(earned.map((e) => [e.referrer, dec(e._sum.reward)])),
      fee: new Map(fees.map((f) => [f.referee, dec(f._sum.fee)])),
    };
  }

  async summaries() {
    const { teams, placed } = await this.placement();
    const wallets = [...placed.keys()];
    const s = await this.stats(wallets);
    const leaderSubs = await this.prisma.subscription.findMany({ where: { wallet: { in: teams.map((t) => t.leader) } }, select: { wallet: true } });
    const subscribed = new Set(leaderSubs.map((x) => x.wallet));
    return teams.map((t) => {
      const members = wallets.filter((w) => placed.get(w)!.leader === t.leader);
      const sum = (m: Map<string, bigint>) => members.reduce((acc, w) => acc + (m.get(w) ?? 0n), 0n);
      return {
        ...view(t),
        leaderSubscribed: subscribed.has(t.leader),
        members: members.length,
        investors: members.filter((w) => (s.invested.get(w) ?? 0n) > 0n).length,
        invested: sum(s.invested).toString(),
        rewards: sum(s.earned).toString(),
        fee: sum(s.fee).toString(),
      };
    });
  }

  async detail(team: Team) {
    const { bindings, referrerOf, placed } = await this.placement();
    const members = [...placed].filter(([, p]) => p.leader === team.leader).map(([w, p]) => [w, p] as [string, TeamPlacement]);
    const wallets = members.map(([w]) => w);
    const s = await this.stats(wallets);
    const boundBlock = new Map(bindings.map((b) => [b.referee, b.boundBlock]));
    const blocks = await this.prisma.chainBlock.findMany({
      where: { chainId: this.chainId, number: { in: wallets.map((w) => boundBlock.get(w)).filter((b): b is bigint => b !== undefined) } },
    });
    const at = new Map(blocks.map((b) => [b.number, b.timestamp]));
    const direct = new Map<string, number>();
    for (const [referee, referrer] of referrerOf) if (placed.get(referee)?.leader === team.leader) direct.set(referrer, (direct.get(referrer) ?? 0) + 1);
    const rows = members
      .map(([w, p]) => {
        const block = boundBlock.get(w);
        return {
          wallet: getAddress(w),
          depth: p.depth,
          invitedBy: p.depth === 0 ? null : getAddress(referrerOf.get(w)!),
          joinedAt: block !== undefined ? (at.get(block) ?? null) : null,
          block: block ?? null,
          invites: direct.get(w) ?? 0,
          invested: (s.invested.get(w) ?? 0n).toString(),
          rewards: (s.earned.get(w) ?? 0n).toString(),
          fee: (s.fee.get(w) ?? 0n).toString(),
        };
      })
      .sort((a, b) => a.depth - b.depth || Number((a.block ?? 0n) - (b.block ?? 0n)));
    const total = (k: "invested" | "rewards" | "fee") => rows.reduce((acc, r) => acc + BigInt(r[k]), 0n).toString();
    return plain({
      team: view(team),
      totals: {
        members: rows.length,
        investors: rows.filter((r) => BigInt(r.invested) > 0n).length,
        invested: total("invested"),
        rewards: total("rewards"),
        fee: total("fee"),
      },
      members: rows.map(({ block: _block, ...r }) => r),
    });
  }
}

const view = (t: Team) => ({ id: t.id, code: t.code, name: t.name, leader: getAddress(t.leader), note: t.note, createdAt: t.createdAt });

/** Resolves a team link (/t/CODE) to its leader, whose address the site then uses as the invite. */
@Controller("teams")
export class PublicTeamController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":code")
  async byCode(@Param("code") raw: string) {
    const code = normalizeTeamCode(raw);
    const team = code ? await this.prisma.team.findUnique({ where: { code } }) : null;
    if (!team) throw notFound("team");
    return { code: team.code, name: team.name, leader: getAddress(team.leader) };
  }
}

/** The team leader's own read-only view: wallet sign-in only, no staff account or on-chain role. */
@Controller("team")
@UseGuards(InvestorGuard)
export class LeaderTeamController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get("me")
  async me(@Req() req: AuthedRequest) {
    const team = await this.prisma.team.findUnique({ where: { leader: req.session!.wallet } });
    if (!team) throw new ApiError(403, "NOT_TEAM_LEADER", "this wallet does not lead a team");
    return new Teams(this.prisma, this.cfg.chainId).detail(team);
  }
}

const createBody = z.object({
  code: z.string().min(1).max(32),
  name: z.string().trim().min(1).max(60),
  leader: z.string().refine((a) => isAddress(a), "leader must be a wallet address"),
  note: z.string().trim().max(500).optional(),
});
const updateBody = z.object({ name: z.string().trim().min(1).max(60).optional(), note: z.string().trim().max(500).nullable().optional() });

@Controller("admin/teams")
@UseGuards(RoleGuard)
@UseInterceptors(IdempotencyInterceptor)
export class AdminTeamController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private teams() {
    return new Teams(this.prisma, this.cfg.chainId);
  }

  @Get()
  @Roles("OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW")
  async list() {
    return plain({ items: await this.teams().summaries() });
  }

  @Get(":id")
  @Roles("OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW")
  async one(@Param("id") id: string) {
    const team = z.string().uuid().safeParse(id).success ? await this.prisma.team.findUnique({ where: { id } }) : null;
    if (!team) throw notFound("team");
    return this.teams().detail(team);
  }

  /**
   * A new team never takes wallets from another one: its leader must not already sit under another
   * team's leader. Code and leader are fixed after creation so links and membership stay stable.
   */
  @Post()
  @Roles("OPERATOR")
  async create(@Req() req: AuthedRequest, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>) {
    const code = normalizeTeamCode(body.code);
    if (!code) throw new ApiError(400, "VALIDATION_FAILED", "code must be 2-16 letters or digits");
    const leader = lc(body.leader);
    const { teams, placed } = await this.teams().placement();
    if (teams.some((t) => t.code === code)) throw new ApiError(409, "TEAM_CODE_TAKEN", "another team already uses this code");
    if (teams.some((t) => t.leader === leader)) throw new ApiError(409, "LEADER_HAS_TEAM", "this wallet already leads a team");
    const inside = placed.get(leader);
    if (inside) {
      const other = teams.find((t) => t.leader === inside.leader)!;
      throw new ApiError(409, "LEADER_IN_TEAM", `this wallet is already a member of team ${other.code}`, { team: other.code });
    }
    const team = await this.prisma.team.create({ data: { code, name: body.name, leader, note: body.note || null, createdByUserId: req.session!.userId } });
    await this.audit(req, "TEAM_CREATE", team.id, { code, name: body.name, leader });
    return plain(view(team));
  }

  @Put(":id")
  @Roles("OPERATOR")
  async update(@Req() req: AuthedRequest, @Param("id") id: string, @Body(new ZodPipe(updateBody)) body: z.infer<typeof updateBody>) {
    const found = z.string().uuid().safeParse(id).success ? await this.prisma.team.findUnique({ where: { id } }) : null;
    if (!found) throw notFound("team");
    const team = await this.prisma.team.update({
      where: { id },
      data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.note !== undefined ? { note: body.note || null } : {}) },
    });
    await this.audit(req, "TEAM_UPDATE", id, body);
    return plain(view(team));
  }

  private async audit(req: AuthedRequest, action: string, targetId: string, payload: unknown) {
    await this.prisma.adminAction.create({
      data: { userId: req.session!.userId, wallet: req.session!.wallet, action, targetType: "team", targetId, payloadHash: keccak256(stringToHex(canonicalJson(payload))) },
    });
  }
}
