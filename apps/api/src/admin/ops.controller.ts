import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { Prisma } from "@roboshare/db";
import { canonicalJson } from "@roboshare/shared";
import { keccak256, stringToHex } from "viem";
import { z } from "zod";
import { Roles, RoleGuard, type AuthedRequest } from "../auth/guards.js";
import { ApiError, notFound } from "../common/errors.js";
import { IdempotencyInterceptor } from "../common/idempotency.js";
import { PrismaService } from "../common/prisma.service.js";
import { lc, plain } from "../common/serialize.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";

const ALL_STAFF = ["OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW"] as const;
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const nonceBody = z.object({ nonce: z.number().int().min(0) });
const executedBody = z.object({ txHash });
const cancelBody = z.object({ reason: z.string().min(2).max(300) });
/**
 * Day-to-day operations from the console (ADMIN_AUTOMATION_PLAN.md batch 1): the governance Safe queue,
 * confirmed and executed by owners from their own wallets. Nothing here signs or sends a transaction.
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

  // ------------------------------------------------------------ helpers

  private async pending(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("safe transaction");
    const row = await this.prisma.safeTx.findUnique({ where: { id } });
    if (!row || row.chainId !== this.cfg.chainId) throw notFound("safe transaction");
    if (row.status !== "PENDING") throw new ApiError(409, "CONFLICT", `transaction is ${row.status}`);
    return row;
  }

  private async audit(req: AuthedRequest, action: string, targetId: string, payload: unknown) {
    await this.prisma.adminAction.create({
      data: { userId: req.session!.userId, wallet: req.session!.wallet, action, targetType: "safe_tx", targetId, payloadHash: keccak256(stringToHex(canonicalJson(payload))) },
    });
  }
}
