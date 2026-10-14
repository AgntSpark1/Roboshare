import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { assetRegistryAbi, canonicalJson, projectFactoryAbi } from "@roboshare/shared";
import { getAddress, isAddress, keccak256, stringToHex, type Address } from "viem";
import { z } from "zod";
import { Roles, RoleGuard, type AuthedRequest } from "../auth/guards.js";
import { ApiError, notFound } from "../common/errors.js";
import { IdempotencyInterceptor } from "../common/idempotency.js";
import { PrismaService } from "../common/prisma.service.js";
import { lc, plain } from "../common/serialize.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { call, queueSafe, viaSafe, type Call } from "./prepare.js";

const OPERATOR_ROLE = keccak256(stringToHex("OPERATOR_ROLE"));
const REVIEWER_ROLE = keccak256(stringToHex("REVIEWER_ROLE"));
const FACTORY_ROLE = keccak256(stringToHex("FACTORY_ROLE"));
const LAUNCHER_ROLE = keccak256(stringToHex("LAUNCHER_ROLE"));
/** Default offering terms record for automatically listed vehicles (replace with an anchored record before mainnet). */
export const DEFAULT_TEMPLATE_TERMS = keccak256(stringToHex("roboshare:offering-terms:auto-listing-v1"));
const EVENT_KINDS = [
  "VEHICLE_REGISTERED", "VEHICLE_VERIFIED", "VEHICLE_LISTED", "LAUNCH_QUEUED", "ACTIVATE_QUEUED",
  "BACKSTOP_FILLED", "BACKSTOP_SHORT", "BACKSTOP_OVER_CAP", "MATCHMAKER_BLOCKED",
];

const settingsBody = z.object({
  launchEnabled: z.boolean(),
  launchMode: z.enum(["AUTO", "SAFE"]),
  maxOpen: z.number().int().min(1).max(20),
  demoVehicles: z.boolean(),
  backstopEnabled: z.boolean(),
  backstopHoursBeforeEnd: z.number().int().min(1).max(24 * 365),
  backstopMaxUsdt: z.number().int().min(0).max(100_000_000),
  autoActivate: z.boolean(),
});

const vehicleBody = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,64}$/),
  title: z.string().min(1).max(64),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  modelYear: z.number().int().min(2000).max(2100).optional(),
  summary: z.string().max(2000).optional(),
  /** Off-chain asset reference (e.g. a salted VIN hash); only its hash goes on-chain. */
  assetRef: z.string().min(8).max(200),
});

const templateBody = z.object({
  enabled: z.boolean(),
  /** Whole USDT per unit. */
  unitPriceUsdt: z.number().int().min(1).max(10_000_000),
  minUnits: z.number().int().min(1).max(100),
  perWalletMax: z.number().int().min(1).max(100),
  durationDays: z.number().int().min(1).max(365),
  termDays: z.number().int().min(1).max(3650),
  minLaunchIntervalMinutes: z.number().int().min(0).max(60 * 24 * 30),
  treasury: z.string().refine((v) => isAddress(v), "treasury must be an address").optional(),
});

/**
 * Robot matchmaking (apps/worker/src/matchmaker.ts) as staff see it: switches, the vehicle queue, what it did, and the
 * one-time Safe setup (launch template plus the minimal roles of its wallets).
 */
@Controller("admin/matchmaker")
@UseGuards(RoleGuard)
@UseInterceptors(IdempotencyInterceptor)
export class MatchmakerController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get()
  @Roles("OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW")
  async status() {
    const settings = await this.settings();
    const queue = await this.prisma.vehicleQueue.findMany({ where: { chainId: this.cfg.chainId }, orderBy: { createdAt: "desc" }, take: 50 });
    const events = await this.prisma.automationEvent.findMany({ where: { chainId: this.cfg.chainId, kind: { in: EVENT_KINDS } }, orderBy: { createdAt: "desc" }, take: 50 });
    const roles = await this.roles(settings);
    const ready = {
      launch: roles.factoryLinked && roles.launcherOperator && roles.verifierReviewer && (settings.launchMode === "SAFE" || roles.launcherLaunch),
      backstop: !!settings.backstopAddress,
    };
    return plain({ settings, factory: this.cfg.projectFactory ?? null, roles, ready, queue, events });
  }

  @Put("settings")
  @Roles("OPERATOR", "GOV_VIEW")
  async putSettings(@Req() req: AuthedRequest, @Body(new ZodPipe(settingsBody)) body: z.infer<typeof settingsBody>) {
    await this.settings();
    const row = await this.prisma.matchmakerSettings.update({ where: { chainId: this.cfg.chainId }, data: { ...body, updatedBy: lc(req.session!.wallet) } });
    await this.audit(req, "MATCHMAKER_SETTINGS", "matchmaker", "settings", body);
    return plain(row);
  }

  @Post("vehicles")
  @Roles("OPERATOR")
  async addVehicle(@Req() req: AuthedRequest, @Body(new ZodPipe(vehicleBody)) body: z.infer<typeof vehicleBody>) {
    if (await this.prisma.vehicleQueue.findUnique({ where: { slug: body.slug } })) throw new ApiError(409, "CONFLICT", "slug already queued");
    if (await this.prisma.projectMeta.findUnique({ where: { slug: body.slug } })) throw new ApiError(409, "CONFLICT", "slug already used");
    const row = await this.prisma.vehicleQueue.create({ data: { chainId: this.cfg.chainId, ...body, createdBy: lc(req.session!.wallet) } });
    await this.audit(req, "MATCHMAKER_VEHICLE_ADD", "vehicle", row.id, body);
    return plain(row);
  }

  /** Removes a vehicle that has not started listing (or failed). */
  @Delete("vehicles/:id")
  @Roles("OPERATOR")
  async removeVehicle(@Req() req: AuthedRequest, @Param("id") id: string) {
    const row = await this.prisma.vehicleQueue.findUnique({ where: { id } }).catch(() => null);
    if (!row) throw notFound("vehicle");
    if (!["QUEUED", "FAILED"].includes(row.status)) throw new ApiError(409, "CONFLICT", `vehicle is ${row.status}`);
    await this.prisma.vehicleQueue.delete({ where: { id } });
    await this.audit(req, "MATCHMAKER_VEHICLE_REMOVE", "vehicle", id, {});
    return { ok: true };
  }

  /**
   * One Safe batch that sets the launch template and grants whatever the matchmaker wallets still miss: FACTORY_ROLE
   * for this factory, OPERATOR / REVIEWER on the AssetRegistry and LAUNCHER_ROLE on the factory. With enabled=false it
   * switches the template off and revokes LAUNCHER_ROLE instead.
   */
  @Post("setup")
  @Roles("OPERATOR", "GOV_VIEW")
  async setup(@Req() req: AuthedRequest, @Body(new ZodPipe(templateBody)) body: z.infer<typeof templateBody>) {
    const factory = this.need(this.cfg.projectFactory, "PROJECT_FACTORY");
    const registry = this.need(this.cfg.assetRegistry, "ASSET_REGISTRY");
    const safe = this.need(this.cfg.safe, "SAFE");
    const settings = await this.settings();
    const roles = await this.roles(settings);
    const treasury = body.treasury ? getAddress(body.treasury) : await this.defaultTreasury(safe);
    const template = {
      enabled: body.enabled,
      unitPrice: BigInt(body.unitPriceUsdt) * 10n ** 18n,
      minUnits: body.minUnits,
      perWalletMax: body.perWalletMax,
      durationDays: body.durationDays,
      termDays: body.termDays,
      minLaunchInterval: body.minLaunchIntervalMinutes * 60,
      treasury,
      termsHash: DEFAULT_TEMPLATE_TERMS,
    };
    const calls: (Call & { description: string })[] = [];
    const launcher = settings.launcherAddress as Address | null;
    const verifier = settings.verifierAddress as Address | null;
    if (body.enabled) {
      if (!roles.factoryLinked) calls.push({ ...call(registry, assetRegistryAbi, "grantRole", [FACTORY_ROLE, factory]), description: "AssetRegistry: grant FACTORY_ROLE to the launch factory" });
      calls.push({ ...call(factory, projectFactoryAbi, "setLaunchTemplate", [template]), description: `ProjectFactory: launch template ${body.unitPriceUsdt} USDT x 100 units, ${body.durationDays} days, term ${body.termDays} days` });
      if (launcher && !roles.launcherOperator) calls.push({ ...call(registry, assetRegistryAbi, "grantRole", [OPERATOR_ROLE, launcher]), description: "AssetRegistry: OPERATOR_ROLE to the matchmaker launcher (register vehicles)" });
      if (verifier && !roles.verifierReviewer) calls.push({ ...call(registry, assetRegistryAbi, "grantRole", [REVIEWER_ROLE, verifier]), description: "AssetRegistry: REVIEWER_ROLE to the matchmaker verifier" });
      if (launcher && settings.launchMode === "AUTO" && !roles.launcherLaunch) calls.push({ ...call(factory, projectFactoryAbi, "grantRole", [LAUNCHER_ROLE, launcher]), description: "ProjectFactory: LAUNCHER_ROLE to the matchmaker launcher" });
    } else {
      calls.push({ ...call(factory, projectFactoryAbi, "setLaunchTemplate", [template]), description: "ProjectFactory: switch automatic listing off" });
      if (launcher && roles.launcherLaunch) calls.push({ ...call(factory, projectFactoryAbi, "revokeRole", [LAUNCHER_ROLE, launcher]), description: "ProjectFactory: revoke LAUNCHER_ROLE" });
    }
    const proposal = await queueSafe(this.prisma, viaSafe(this.cfg.chainId, safe, calls, `matchmaker ${body.enabled ? "setup" : "off"}`), req.session!.wallet);
    await this.audit(req, "MATCHMAKER_SETUP", "matchmaker", "template", body);
    return plain({ proposal });
  }

  private async settings() {
    return this.prisma.matchmakerSettings.upsert({ where: { chainId: this.cfg.chainId }, update: {}, create: { chainId: this.cfg.chainId } });
  }

  /** What the indexed role grants say about the matchmaker wallets. */
  private async roles(s: { launcherAddress: string | null; verifierAddress: string | null }) {
    const factory = this.cfg.projectFactory ? lc(this.cfg.projectFactory) : null;
    const registry = this.cfg.assetRegistry ? lc(this.cfg.assetRegistry) : null;
    const grants = await this.prisma.roleGrant.findMany({ where: { chainId: this.cfg.chainId, active: true, role: { in: [OPERATOR_ROLE, REVIEWER_ROLE, FACTORY_ROLE, LAUNCHER_ROLE] } } });
    const has = (contract: string | null, role: string, account: string | null) =>
      !!contract && !!account && grants.some((g) => lc(g.contract) === contract && g.role === role && lc(g.account) === lc(account));
    return {
      factoryLinked: has(registry, FACTORY_ROLE, factory),
      launcherOperator: has(registry, OPERATOR_ROLE, s.launcherAddress),
      verifierReviewer: has(registry, REVIEWER_ROLE, s.verifierAddress),
      launcherLaunch: has(factory, LAUNCHER_ROLE, s.launcherAddress),
    };
  }

  /** The treasury of the most recent offering, else the Safe. */
  private async defaultTreasury(safe: Address): Promise<Address> {
    const last = await this.prisma.offering.findFirst({ orderBy: { startAt: "desc" } });
    return last ? getAddress(last.treasury) : safe;
  }

  private need<T>(v: T | undefined, name: string): T {
    if (!v) throw new ApiError(503, "CHAIN_UNAVAILABLE", `${name} is not configured`);
    return v;
  }

  private async audit(req: AuthedRequest, action: string, targetType: string, targetId: string, body: unknown) {
    await this.prisma.adminAction.create({
      data: { userId: req.session!.userId, wallet: req.session!.wallet, action, targetType, targetId, payloadHash: keccak256(stringToHex(canonicalJson(body))) },
    });
  }
}
