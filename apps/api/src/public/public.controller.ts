import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { SHARE_CAP, tiersForTerm } from "@roboshare/shared";
import { getAddress } from "viem";
import { ApiError, notFound } from "../common/errors.js";
import { PrismaService } from "../common/prisma.service.js";
import { plain } from "../common/serialize.js";
import { APP_CONFIG, type AppConfig } from "../config.js";

const DAY_MS = 86_400_000;

/** Operating term as investors see it. endsAt / remainingDays stay null until the vehicle starts operating. */
function term(p: { termDays: number | null; operatingStartedAt: Date | null }, now = Date.now()) {
  if (p.termDays == null) return null;
  const endsAt = p.operatingStartedAt ? new Date(p.operatingStartedAt.getTime() + p.termDays * DAY_MS) : null;
  return {
    termDays: p.termDays,
    startedAt: p.operatingStartedAt,
    endsAt,
    remainingDays: endsAt ? Math.max(0, Math.ceil((endsAt.getTime() - now) / DAY_MS)) : null,
  };
}

const PROJECT_ID = /^0x[0-9a-fA-F]{64}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

@Controller()
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get("health")
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    const cursor = await this.prisma.indexerCursor.findUnique({ where: { chainId: this.cfg.chainId } });
    return plain({
      status: "ok",
      chainId: this.cfg.chainId,
      indexer: cursor ? { lastBlock: cursor.lastBlock, updatedAt: cursor.updatedAt } : null,
    });
  }

  @Get("projects")
  async projects() {
    const [projects, metas] = await Promise.all([
      this.prisma.project.findMany({ include: { offering: true }, orderBy: { registeredBlock: "asc" } }),
      this.prisma.projectMeta.findMany(),
    ]);
    const meta = new Map(metas.map((m) => [m.projectIdOnchain, m]));
    const supply = await this.supplies();
    return plain({
      items: projects.map((p) => ({
        id: p.projectIdOnchain,
        title: meta.get(p.projectIdOnchain)?.title ?? null,
        slug: meta.get(p.projectIdOnchain)?.slug ?? null,
        make: meta.get(p.projectIdOnchain)?.make ?? null,
        model: meta.get(p.projectIdOnchain)?.model ?? null,
        state: p.state,
        issuedUnits: supply.get(p.projectIdOnchain) ?? 0,
        authorizedUnits: SHARE_CAP,
        term: term(p),
        offering: p.offering
          ? { status: p.offering.status, unitsSold: p.offering.unitsSold, minUnits: p.offering.minUnits, maxUnits: p.offering.maxUnits, unitPrice: p.offering.unitPrice, startAt: p.offering.startAt, endAt: p.offering.endAt }
          : null,
      })),
    });
  }

  /**
   * Daily operating revenue for the website. Days not yet in an approved monthly report are pending: they are paid
   * out with the next monthly distribution.
   */
  @Get("projects/:id/daily-revenue")
  async dailyRevenue(@Param("id") id: string, @Query("days") days?: string) {
    if (!PROJECT_ID.test(id)) throw notFound("project");
    const n = Math.min(Math.max(Number(days) || 30, 1), 366);
    const rows = await this.prisma.dailyOperating.findMany({ where: { projectIdOnchain: id }, orderBy: { day: "desc" }, take: n });
    const approved = await this.prisma.financialReport.findMany({ where: { projectIdOnchain: id, status: "APPROVED" }, select: { periodStart: true, periodEnd: true } });
    const settled = (d: Date) => approved.some((r) => r.periodStart <= d && d < r.periodEnd);
    return plain({
      items: rows.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        revenue: r.revenue,
        expenses: r.expenses,
        net: (BigInt(r.revenue.toFixed()) - BigInt(r.expenses.toFixed())).toString(),
        rides: r.rides,
        status: settled(r.day) ? "SETTLED" : "PENDING",
      })),
    });
  }

  @Get("projects/:id")
  async project(@Param("id") id: string) {
    if (!PROJECT_ID.test(id)) throw notFound("project");
    const p = await this.prisma.project.findUnique({
      where: { projectIdOnchain: id },
      include: { offering: true, stateChanges: { orderBy: { blockNumber: "asc" } } },
    });
    if (!p) throw notFound("project");
    const meta = await this.prisma.projectMeta.findUnique({ where: { projectIdOnchain: id } });
    const supply = await this.supplies(id);
    return plain({
      id: p.projectIdOnchain,
      assetId: p.assetIdOnchain,
      legalInterest: "CONTRACTUAL_ECONOMIC_RIGHT", // D-1
      rightsDocHash: p.rightsDocHash,
      meta: meta ? { title: meta.title, slug: meta.slug, make: meta.make, model: meta.model, modelYear: meta.modelYear, summary: meta.summary } : null,
      state: p.state,
      issuedUnits: supply.get(id) ?? 0,
      authorizedUnits: SHARE_CAP,
      contracts: { token: p.tokenAddress, offering: p.offeringAddress, distributor: p.distributorAddress },
      fundedAtBlock: p.fundedAtBlock,
      term: term(p),
      offering: p.offering
        ? {
            status: p.offering.status,
            unitPrice: p.offering.unitPrice,
            minUnits: p.offering.minUnits,
            maxUnits: p.offering.maxUnits,
            perWalletMax: p.offering.perWalletMax,
            unitsSold: p.offering.unitsSold,
            startAt: p.offering.startAt,
            endAt: p.offering.endAt,
            termsHash: p.offering.termsHash,
          }
        : null,
      feeTiers: tiersForTerm(p.termDays),
      stateHistory: p.stateChanges.map((s) => ({
        from: s.fromState,
        to: s.toState,
        reasonHash: s.reasonHash,
        chain: { chainId: this.cfg.chainId, txHash: s.txHash, blockNumber: s.blockNumber, confirmed: true },
      })),
    });
  }

  @Get("projects/:id/financials")
  async financials(@Param("id") id: string) {
    const records = await this.prisma.auditRecord.findMany({
      where: { projectIdOnchain: id, kind: "FINANCIAL_REPORT", status: "APPROVED" },
      orderBy: { periodStart: "asc" },
    });
    const reports = await this.prisma.financialReport.findMany({
      where: { recordIdOnchain: { in: records.map((r) => r.recordIdOnchain) } },
    });
    const byRecord = new Map(reports.map((r) => [r.recordIdOnchain, r]));
    return plain({
      items: records.map((r) => {
        const off = byRecord.get(r.recordIdOnchain);
        return {
          figureKind: "ACTUAL",
          recordId: r.recordIdOnchain,
          periodStart: new Date(Number(r.periodStart) * 1000),
          periodEnd: new Date(Number(r.periodEnd) * 1000),
          distributableAmount: r.distributableAmount,
          grossRevenue: off?.grossRevenue ?? null,
          totalExpenses: off?.totalExpenses ?? null,
          totalReserves: off?.totalReserves ?? null,
          paymentToken: r.paymentToken,
          assuranceLevel: "REVIEWER_APPROVED",
          contentHash: r.contentHash,
          version: r.version,
        };
      }),
    });
  }

  @Get("projects/:id/distributions")
  async distributions(@Param("id") id: string) {
    const batches = await this.prisma.distributionBatch.findMany({
      where: { projectIdOnchain: id, status: "CLAIMABLE" },
      orderBy: { batchIdOnchain: "asc" },
    });
    return plain({
      items: batches.map((b) => ({
        figureKind: "ACTUAL",
        batchId: b.batchIdOnchain,
        reportId: b.reportId,
        amount: b.amount,
        pool: b.pool,
        totalNet: b.totalNet,
        totalFee: b.totalFee,
        dust: b.dustOut,
        capitalReturn: b.capitalReturn,
        snapshotBlock: b.snapshotBlock,
        chain: { chainId: this.cfg.chainId, txHash: b.approveTxHash, confirmed: true },
      })),
    });
  }

  @Get("projects/:id/records/:recordId/verify")
  async verify(@Param("id") id: string, @Param("recordId") recordId: string, @Query("hash") hash: string) {
    if (!HASH.test(hash ?? "")) throw new ApiError(400, "VALIDATION_FAILED", "hash must be a 32-byte hex string");
    const r = await this.prisma.auditRecord.findUnique({ where: { recordIdOnchain: recordId } });
    if (!r || r.projectIdOnchain !== id) throw notFound("record");
    return { recordId, status: r.status, matches: r.status !== "REJECTED" && r.contentHash.toLowerCase() === hash.toLowerCase() };
  }

  @Get("contracts")
  async contracts() {
    const rows = await this.prisma.contractDeployment.findMany({ where: { chainId: this.cfg.chainId }, orderBy: { deployedBlock: "asc" } });
    return plain({
      chainId: this.cfg.chainId,
      items: rows.map((r) => ({ kind: r.kind, address: getAddress(r.address), projectId: r.projectId, deployedBlock: r.deployedBlock })),
    });
  }

  /**
   * Completed resale-market trades (ShareMarket Purchased events), newest first, plus a per-project
   * reference: last traded price and 30-day activity. Listings themselves are read from the chain.
   */
  @Get("market/trades")
  async marketTrades(@Query("projectId") projectId?: string) {
    if (projectId !== undefined && !PROJECT_ID.test(projectId)) throw new ApiError(400, "VALIDATION_FAILED", "projectId must be a 32-byte hex string");
    const markets = await this.prisma.contractDeployment.findMany({ where: { chainId: this.cfg.chainId, kind: "SHARE_MARKET" } });
    if (markets.length === 0) return { items: [], stats: [] };
    const events = await this.prisma.chainEvent.findMany({
      where: {
        chainId: this.cfg.chainId,
        name: "Purchased",
        address: { in: markets.map((m) => m.address) },
        ...(projectId ? { args: { path: ["projectId"], equals: projectId.toLowerCase() } } : {}),
      },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: 1000,
    });
    const blocks = await this.prisma.chainBlock.findMany({
      where: { chainId: this.cfg.chainId, number: { in: [...new Set(events.map((e) => e.blockNumber))] } },
    });
    const at = new Map(blocks.map((b) => [b.number, b.timestamp]));
    const trades = events.map((e) => {
      const a = e.args as Record<string, string>;
      return {
        projectId: a.projectId!.toLowerCase(),
        listingId: a.listingId,
        buyer: a.buyer,
        seller: a.seller,
        units: Number(a.units),
        pricePerUnit: a.pricePerUnit,
        cost: a.cost,
        at: at.get(e.blockNumber) ?? null,
        chain: { chainId: e.chainId, txHash: e.txHash, blockNumber: e.blockNumber, confirmed: true },
      };
    });
    const since = Date.now() - 30 * 86_400_000;
    const stats = new Map<string, { projectId: string; lastPrice: string; lastAt: Date | null; trades30d: number; units30d: number }>();
    for (const t of trades) {
      const s = stats.get(t.projectId) ?? { projectId: t.projectId, lastPrice: t.pricePerUnit!, lastAt: t.at, trades30d: 0, units30d: 0 };
      if (t.at && t.at.getTime() >= since) {
        s.trades30d += 1;
        s.units30d += t.units;
      }
      stats.set(t.projectId, s);
    }
    return plain({ items: trades.slice(0, 50), stats: [...stats.values()] });
  }

  /** Phase 5: read-only Aave V3 (BNB Chain) market data. Informational only; RoboShare never deposits. */
  @Get("aave/markets")
  async aaveMarkets() {
    const s = await this.prisma.aaveMarketSnapshot.findFirst({ orderBy: { blockNumber: "desc" } });
    if (!s) throw new ApiError(503, "CHAIN_UNAVAILABLE", "no verified Aave market read yet");
    const ageSeconds = Math.floor((Date.now() - s.blockTime.getTime()) / 1000);
    return plain({
      figureKind: "ACTUAL",
      readOnly: true,
      disclaimer: "Third-party market data from Aave V3 on BNB Chain. Not RoboShare returns and not an offer to deposit.",
      chainId: s.chainId,
      blockNumber: s.blockNumber,
      blockHash: s.blockHash,
      blockTime: s.blockTime,
      stale: ageSeconds > 30 * 60,
      source: s.source,
      addresses: s.addresses,
      reserves: s.reserves,
    });
  }

  private async supplies(projectId?: string) {
    const rows = await this.prisma.holding.groupBy({
      by: ["projectIdOnchain"],
      _sum: { units: true },
      ...(projectId ? { where: { projectIdOnchain: projectId } } : {}),
    });
    return new Map(rows.map((r) => [r.projectIdOnchain, r._sum.units ?? 0]));
  }
}
