import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service.js";
import { plain } from "../common/serialize.js";
import { InvestorGuard, type AuthedRequest } from "../auth/guards.js";

/** Investor views. Value-moving actions are signed by the wallet directly against the contracts. */
@Controller("me")
@UseGuards(InvestorGuard)
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("eligibility")
  async eligibility(@Req() req: AuthedRequest) {
    const e = await this.prisma.eligibility.findUnique({ where: { wallet: req.session!.wallet } });
    const expired = !!e?.expiresAt && e.expiresAt.getTime() <= Date.now();
    return plain({
      wallet: req.session!.wallet,
      status: e?.status ?? "NONE",
      investorClass: e?.investorClass ?? null,
      expiresAt: e?.expiresAt ?? null,
      eligibleNow: e?.status === "ELIGIBLE" && !expired,
    });
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
      include: { batch: { select: { snapshotBlock: true, reportId: true } } },
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
      })),
    });
  }
}
