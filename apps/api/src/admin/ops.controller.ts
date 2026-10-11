import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { Prisma } from "@roboshare/db";
import { canonicalJson, identityRegistryAbi } from "@roboshare/shared";
import { getAddress, isAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { Roles, RoleGuard, type AuthedRequest } from "../auth/guards.js";
import { ApiError, notFound } from "../common/errors.js";
import { IdempotencyInterceptor } from "../common/idempotency.js";
import { PrismaService } from "../common/prisma.service.js";
import { lc, plain } from "../common/serialize.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { prepare } from "./prepare.js";

const ALL_STAFF = ["OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW"] as const;
const address = z.string().refine((v) => isAddress(v), "invalid address");
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/** IdentityRegistry.MAX_BATCH */
export const ELIGIBILITY_MAX_BATCH = 50;
/** Default investor class / jurisdiction codes, as used by the testnet scripts (no real KYC yet, see PHASE1 D-11). */
const DEFAULT_CLASS = 1;
const DEFAULT_JURISDICTION = 0;

const nonceBody = z.object({ nonce: z.number().int().min(0) });
const executedBody = z.object({ txHash });
const cancelBody = z.object({ reason: z.string().min(2).max(300) });
const eligibilityBody = z.object({
  wallets: z.array(address).min(1).max(ELIGIBILITY_MAX_BATCH),
  /** Days until it expires; 0 = no expiry. */
  days: z.number().int().min(0).max(3650).default(365),
  note: z.string().max(200).default("manual review in admin console"),
});
const revokeBody = z.object({ wallet: address, reason: z.string().min(3).max(300) });

/**
 * Day-to-day operations from the console (ADMIN_AUTOMATION_PLAN.md batch 1):
 * - the governance Safe queue, confirmed and executed by owners from their own wallets;
 * - investor eligibility, signed by the compliance wallet.
 * Nothing here signs or sends a transaction.
 */
@Controller("admin")
@UseGuards(RoleGuard)
@UseInterceptors(IdempotencyInterceptor)
export class OpsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ------------------------------------------------------------ Safe queue

  @Get("safe-txs")
  @Roles(...ALL_STAFF)
  async safeTxs(@Query("status") status?: string) {
    const where = status === "all" ? { chainId: this.cfg.chainId } : { chainId: this.cfg.chainId, status: status || "PENDING" };
    const items = await this.prisma.safeTx.findMany({ where, orderBy: { createdAt: status === "PENDING" || !status ? "asc" : "desc" }, take: 100 });
    return plain({ items });
  }

  /**
   * Fixes the Safe nonce at the first confirmation, so every owner confirms the same hash. The browser reads the
   * chain nonce; the unique index stops two pending transactions from taking the same one.
   */
  @Post("safe-txs/:id/nonce")
  @Roles(...ALL_STAFF)
  @HttpCode(200)
  async setNonce(@Req() req: AuthedRequest, @Param("id") id: string, @Body(new ZodPipe(nonceBody)) body: z.infer<typeof nonceBody>) {
    const row = await this.pending(id);
    if (row.safeNonce !== null) {
      if (row.safeNonce === body.nonce) return plain(row);
      throw new ApiError(409, "CONFLICT", `nonce already fixed at ${row.safeNonce}`);
    }
    const taken = () => new ApiError(409, "CONFLICT", "that nonce is taken by another pending transaction; reload and try again");
    try {
      const { count } = await this.prisma.safeTx.updateMany({ where: { id, status: "PENDING", safeNonce: null }, data: { safeNonce: body.nonce } });
      if (count === 0) throw taken();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw taken();
      throw e;
    }
    await this.audit(req, "SAFE_TX_NONCE", id, body);
    return plain(await this.prisma.safeTx.findUniqueOrThrow({ where: { id } }));
  }

  /** The Safe nonce moved past this transaction without it (another transaction used it): renumber and re-confirm. */
  @Post("safe-txs/:id/renumber")
  @Roles(...ALL_STAFF)
  @HttpCode(200)
  async renumber(@Req() req: AuthedRequest, @Param("id") id: string) {
    await this.pending(id);
    const updated = await this.prisma.safeTx.update({ where: { id }, data: { safeNonce: null } });
    await this.audit(req, "SAFE_TX_RENUMBER", id, {});
    return plain(updated);
  }

  @Post("safe-txs/:id/executed")
  @Roles(...ALL_STAFF)
  @HttpCode(200)
  async executed(@Req() req: AuthedRequest, @Param("id") id: string, @Body(new ZodPipe(executedBody)) body: z.infer<typeof executedBody>) {
    const row = await this.pending(id);
    if (row.safeNonce === null) throw new ApiError(409, "CONFLICT", "transaction has no nonce yet");
    const updated = await this.prisma.safeTx.update({
      where: { id },
      data: { status: "EXECUTED", execTxHash: body.txHash.toLowerCase(), closedAt: new Date(), closedBy: lc(req.session!.wallet) },
    });
    await this.audit(req, "SAFE_TX_EXECUTED", id, body);
    return plain(updated);
  }

  /** Drops a queued transaction. Later ones keep their nonce; if this one had a nonce they are renumbered. */
  @Post("safe-txs/:id/cancel")
  @Roles("GOV_VIEW", "OPERATOR")
  @HttpCode(200)
  async cancel(@Req() req: AuthedRequest, @Param("id") id: string, @Body(new ZodPipe(cancelBody)) body: z.infer<typeof cancelBody>) {
    const row = await this.pending(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const done = await tx.safeTx.update({
        where: { id },
        data: { status: "CANCELLED", closedAt: new Date(), closedBy: lc(req.session!.wallet), closeReason: body.reason },
      });
      // A gap in the nonce sequence would block every later transaction, so they pick fresh nonces.
      if (row.safeNonce !== null) {
        await tx.safeTx.updateMany({
          where: { chainId: row.chainId, safe: row.safe, status: "PENDING", safeNonce: { gt: row.safeNonce } },
          data: { safeNonce: null },
        });
      }
      return done;
    });
    await this.audit(req, "SAFE_TX_CANCEL", id, body);
    return plain(updated);
  }

  // ------------------------------------------------------------ investors

  /** Every wallet that has signed in to the investor site, with its indexed eligibility and activity. */
  @Get("investors")
  @Roles(...ALL_STAFF)
  async investors(@Query("filter") filter?: string) {
    const staffUsers = new Set((await this.prisma.staffAccount.findMany({ select: { userId: true } })).map((s) => s.userId));
    const wallets = await this.prisma.wallet.findMany({ orderBy: { linkedAt: "desc" }, take: 1000 });
    const addrs = wallets.map((w) => w.address);
    const [elig, subs, holds, acks] = await Promise.all([
      this.prisma.eligibility.findMany({ where: { wallet: { in: addrs } } }),
      this.prisma.subscription.groupBy({ by: ["wallet"], where: { wallet: { in: addrs } }, _sum: { units: true } }),
      this.prisma.holding.groupBy({ by: ["wallet"], where: { wallet: { in: addrs } }, _sum: { units: true } }),
      this.prisma.riskAcknowledgement.findMany({ where: { userId: { in: wallets.map((w) => w.userId) } }, select: { userId: true } }),
    ]);
    const eMap = new Map(elig.map((e) => [e.wallet, e]));
    const sMap = new Map(subs.map((s) => [s.wallet, s._sum.units ?? 0]));
    const hMap = new Map(holds.map((h) => [h.wallet, h._sum.units ?? 0]));
    const ackSet = new Set(acks.map((a) => a.userId));
    const now = Date.now();
    let items = wallets.map((w) => {
      const e = eMap.get(w.address);
      const expired = !!e?.expiresAt && e.expiresAt.getTime() <= now;
      const status = !e || e.status === "NONE" ? "NONE" : e.status === "FROZEN" ? "FROZEN" : expired ? "EXPIRED" : "ELIGIBLE";
      return {
        wallet: getAddress(w.address),
        linkedAt: w.linkedAt,
        staff: staffUsers.has(w.userId),
        status,
        expiresAt: e?.expiresAt ?? null,
        subscribedUnits: sMap.get(w.address) ?? 0,
        heldUnits: hMap.get(w.address) ?? 0,
        riskAcknowledged: ackSet.has(w.userId),
      };
    });
    if (filter === "pending") items = items.filter((i) => !i.staff && (i.status === "NONE" || i.status === "EXPIRED"));
    const counts = {
      total: items.length,
      pending: items.filter((i) => !i.staff && (i.status === "NONE" || i.status === "EXPIRED")).length,
    };
    return plain({ items, counts, maxBatch: ELIGIBILITY_MAX_BATCH });
  }

  /** batchSetEligibility for the compliance wallet. There is no real KYC yet: this records a manual decision. */
  @Post("eligibility")
  @Roles("COMPLIANCE")
  async eligibility(@Req() req: AuthedRequest, @Body(new ZodPipe(eligibilityBody)) body: z.infer<typeof eligibilityBody>) {
    const registry = await this.identityRegistry();
    const wallets = [...new Set(body.wallets.map((w) => getAddress(w)))];
    const frozen = await this.prisma.eligibility.findMany({ where: { wallet: { in: wallets.map(lc) }, status: "FROZEN" } });
    if (frozen.length) throw new ApiError(409, "CONFLICT", "frozen wallets need governance to unfreeze first", { wallets: frozen.map((f) => getAddress(f.wallet)) });
    const expiry = body.days === 0 ? 0n : BigInt(Math.floor(Date.now() / 1000) + body.days * 86_400);
    const ref = keccak256(stringToHex(`manual:${body.note}`));
    const n = wallets.length;
    await this.audit(req, "ELIGIBILITY_PREPARE", "batch", { wallets, days: body.days, note: body.note });
    return {
      tx: prepare(
        this.cfg.chainId,
        registry,
        identityRegistryAbi,
        "batchSetEligibility",
        [wallets, Array(n).fill(DEFAULT_CLASS), Array(n).fill(DEFAULT_JURISDICTION), Array(n).fill(expiry), Array(n).fill(ref)],
        `Make ${n} wallet(s) eligible (compliance wallet)`,
      ),
    };
  }

  @Post("eligibility/revoke")
  @Roles("COMPLIANCE")
  async revoke(@Req() req: AuthedRequest, @Body(new ZodPipe(revokeBody)) body: z.infer<typeof revokeBody>) {
    const registry = await this.identityRegistry();
    const e = await this.prisma.eligibility.findUnique({ where: { wallet: lc(body.wallet) } });
    if (!e || e.status !== "ELIGIBLE") throw notFound("eligible wallet");
    await this.audit(req, "ELIGIBILITY_REVOKE_PREPARE", lc(body.wallet), body);
    return { tx: prepare(this.cfg.chainId, registry, identityRegistryAbi, "revoke", [getAddress(body.wallet), keccak256(stringToHex(body.reason)) as Hex], "Revoke eligibility (compliance wallet)") };
  }

  // ------------------------------------------------------------ helpers

  private async pending(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("safe transaction");
    const row = await this.prisma.safeTx.findUnique({ where: { id } });
    if (!row || row.chainId !== this.cfg.chainId) throw notFound("safe transaction");
    if (row.status !== "PENDING") throw new ApiError(409, "CONFLICT", `transaction is ${row.status}`);
    return row;
  }

  private async identityRegistry(): Promise<Address> {
    const row = await this.prisma.contractDeployment.findFirst({ where: { chainId: this.cfg.chainId, kind: "IDENTITY_REGISTRY" } });
    if (!row) throw new ApiError(503, "CHAIN_UNAVAILABLE", "IdentityRegistry is not indexed yet");
    return getAddress(row.address);
  }

  private async audit(req: AuthedRequest, action: string, targetId: string, payload: unknown) {
    await this.prisma.adminAction.create({
      data: { userId: req.session!.userId, wallet: req.session!.wallet, action, targetType: action.startsWith("SAFE") ? "safe_tx" : "eligibility", targetId, payloadHash: keccak256(stringToHex(canonicalJson(payload))) },
    });
  }
}
