import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { DEFAULT_TIERS, SHARE_CAP } from "@roboshare/shared";
import { getAddress } from "viem";
import { ApiError, notFound } from "../common/errors.js";
import { PrismaService } from "../common/prisma.service.js";
import { plain } from "../common/serialize.js";
import { APP_CONFIG, type AppConfig } from "../config.js";

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
        offering: p.offering
          ? { status: p.offering.status, unitsSold: p.offering.unitsSold, minUnits: p.offering.minUnits, maxUnits: p.offering.maxUnits, unitPrice: p.offering.unitPrice, endAt: p.offering.endAt }
          : null,
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
      feeTiers: DEFAULT_TIERS,
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
