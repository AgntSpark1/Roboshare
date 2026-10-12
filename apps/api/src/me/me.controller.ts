import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { getAddress } from "viem";
import { z } from "zod";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { PrismaService } from "../common/prisma.service.js";
import { plain } from "../common/serialize.js";
import { InvestorGuard, type AuthedRequest } from "../auth/guards.js";

/** Investor views. Value-moving actions are signed by the wallet directly against the contracts. */
@Controller("me")
@UseGuards(InvestorGuard)
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Mints, transfers, subscriptions, refunds and claims involving this wallet, plus UI-submitted pending txs. */
  @Get("transactions")
  async transactions(@Req() req: AuthedRequest) {
    const w = getAddress(req.session!.wallet); // event args are stored checksummed
    const events = await this.prisma.chainEvent.findMany({
      where: {
        chainId: this.cfg.chainId,
        OR: [
          { name: "Transfer", args: { path: ["from"], equals: w } },
          { name: "Transfer", args: { path: ["to"], equals: w } },
          { name: "Subscribed", args: { path: ["investor"], equals: w } },
          { name: "RefundClaimed", args: { path: ["investor"], equals: w } },
          { name: "Claimed", args: { path: ["holder"], equals: w } },
        ],
      },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: 200,
    });
    // USDT Approval events are not indexed, so approval txs would never leave the pending list.
    const pending = await this.prisma.pendingTx.findMany({
      where: { userId: req.session!.userId, chainId: this.cfg.chainId, purpose: { notIn: ["APPROVE", "REVOKE_APPROVAL"] } },
    });
    const seen = new Set(events.map((e) => e.txHash.toLowerCase()));
    return plain({
      items: events.map((e) => {
        const a = e.args as Record<string, string>;
        const kind = e.name === "Transfer" ? (a.from === "0x0000000000000000000000000000000000000000" ? "MINT" : a.from === w ? "TRANSFER_OUT" : "TRANSFER_IN") : e.name === "Subscribed" ? "SUBSCRIBE" : e.name === "RefundClaimed" ? "REFUND" : "CLAIM";
        return { kind, contract: getAddress(e.address), args: a, chain: { chainId: e.chainId, txHash: e.txHash, blockNumber: e.blockNumber, confirmed: true } };
      }),
      pending: pending.filter((p) => !seen.has(p.hash.toLowerCase())).map((p) => ({ hash: p.hash, purpose: p.purpose, submittedAt: p.createdAt })),
    });
  }

  @Post("risk-acknowledgement")
  @HttpCode(201)
  async acknowledge(@Req() req: AuthedRequest, @Body(new ZodPipe(z.object({ version: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/) }))) body: { version: string }) {
    const row = await this.prisma.riskAcknowledgement.upsert({
      where: { userId_version: { userId: req.session!.userId, version: body.version } },
      create: { userId: req.session!.userId, wallet: req.session!.wallet, version: body.version },
      update: {},
    });
    return plain({ version: row.version, acceptedAt: row.acceptedAt });
  }

  /** There is no KYC (owner decision, 2026-10-11): any wallet may invest unless it is on the freeze list. */
  @Get("eligibility")
  async eligibility(@Req() req: AuthedRequest) {
    const e = await this.prisma.eligibility.findUnique({ where: { wallet: req.session!.wallet } });
    const frozen = e?.status === "FROZEN";
    return plain({ wallet: req.session!.wallet, frozen, eligibleNow: !frozen });
  }

  @Get("portfolio")
  async portfolio(@Req() req: AuthedRequest) {
    const wallet = req.session!.wallet;
    const holdings = await this.prisma.holding.findMany({ where: { wallet } });
    const supplies = await this.prisma.holding.groupBy({
      by: ["projectIdOnchain"],
      where: { projectIdOnchain: { in: holdings.map((h) => h.projectIdOnchain) } },
      _sum: { units: true },
    });
    const supply = new Map(supplies.map((s) => [s.projectIdOnchain, s._sum.units ?? 0]));
    const subs = await this.prisma.subscription.findMany({ where: { wallet, status: "SETTLED" } });
    const cost = new Map(subs.map((s) => [s.projectIdOnchain, s.amount]));
    return plain({
      items: holdings.map((h) => ({
        projectId: h.projectIdOnchain,
        units: h.units,
        issuedUnits: supply.get(h.projectIdOnchain) ?? 0,
        // Basis points of issued supply (D-4: shares are pro-rata over issued units).
        shareBps: Math.floor((h.units * 10_000) / (supply.get(h.projectIdOnchain) || 1)),
        costBasis: cost.get(h.projectIdOnchain) ?? null,
      })),
    });
  }

  @Get("subscriptions")
  async subscriptions(@Req() req: AuthedRequest) {
    const subs = await this.prisma.subscription.findMany({
      where: { wallet: req.session!.wallet },
      include: { offering: { select: { status: true, endAt: true } } },
    });
    return plain({
      items: subs.map((s) => ({
        projectId: s.projectIdOnchain,
        units: s.units,
        amount: s.amount,
        status: s.status,
        offeringStatus: s.offering.status,
        refundAvailable: s.status === "REFUNDABLE",
        lastTxHash: s.lastTxHash,
      })),
    });
  }

  @Get("distributions")
  async distributions(@Req() req: AuthedRequest) {
    const rows = await this.prisma.distributionAllocation.findMany({
      where: { wallet: req.session!.wallet, batch: { status: "CLAIMABLE" } },
      include: { batch: { select: { snapshotBlock: true, reportId: true, capitalReturn: true } } },
      orderBy: [{ projectIdOnchain: "asc" }, { batchIdOnchain: "asc" }],
    });
    return plain({
      items: rows.map((a) => ({
        figureKind: "ACTUAL",
        projectId: a.projectIdOnchain,
        batchId: a.batchIdOnchain,
        reportId: a.batch.reportId,
        snapshotBlock: a.batch.snapshotBlock,
        units: a.units,
        gross: a.gross,
        feeBps: a.feeBps,
        fee: (BigInt(a.gross.toFixed()) - BigInt(a.net.toFixed())).toString(),
        net: a.net,
        claimed: a.claimed,
        claimTxHash: a.claimTxHash,
        capitalReturn: a.batch.capitalReturn,
      })),
    });
  }
}
