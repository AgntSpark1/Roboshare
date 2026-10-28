import type { Prisma, PrismaClient } from "@roboshare/db";
import { PROJECT_STATES, RECORD_KINDS, RECORD_STATUSES, referralRewards, REFERRAL_LEVEL_BPS } from "@roboshare/shared";
import type { ContractKind } from "./contracts.js";
import { restoreRecoveryBaseline } from "./recovery.js";

type Tx = Prisma.TransactionClient;
type Args = Record<string, any>; // decoded event args, bigint already converted to strings

export interface StoredEvent {
  id: string;
  chainId: number;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
  address: string;
  name: string;
  args: Args;
  /** Contract kind and, for per-project contracts, the project id. */
  kind: ContractKind;
  projectId: string | null;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const lc = (a: string) => a.toLowerCase();

/**
 * Applies one chain event to the read-model tables. Must be deterministic: the same ordered
 * event stream always yields the same projections (rebuild() relies on this after a reorg).
 */
export async function applyEvent(tx: Tx, e: StoredEvent): Promise<void> {
  const a = e.args;
  switch (e.name) {
    // ------------------------------------------------------------ roles (every contract)
    case "RoleGranted":
    case "RoleRevoked": {
      const key = { chainId: e.chainId, contract: lc(e.address), role: a.role, account: lc(a.account) };
      const active = e.name === "RoleGranted";
      await tx.roleGrant.upsert({
        where: { chainId_contract_role_account: key },
        create: { ...key, active, eventId: e.id },
        update: { active, eventId: e.id },
      });
      return;
    }

    // ------------------------------------------------------------ identity
    // IdentityRegistry is a freeze list only (no KYC); the eligibility table records FROZEN or NONE.
    case "WalletFrozen":
      await setFrozen(tx, a.wallet, e.blockNumber, true);
      return;
    case "WalletUnfrozen":
      await setFrozen(tx, a.wallet, e.blockNumber, false);
      return;

    // ------------------------------------------------------------ asset registry
    case "ProjectRegistered":
      await tx.project.create({
        data: {
          projectIdOnchain: a.projectId,
          assetIdOnchain: a.assetId,
          issuerId: a.issuerId,
          rightsDocHash: a.rightsDocHash,
          registrant: lc(a.registrant),
          state: "NONE",
          registeredBlock: e.blockNumber,
        },
      });
      return;
    case "DraftUpdated":
      await tx.project.update({
        where: { projectIdOnchain: a.projectId },
        data: { issuerId: a.issuerId, rightsDocHash: a.rightsDocHash },
      });
      return;
    case "ProjectStateChanged": {
      const from = PROJECT_STATES[Number(a.from)]!;
      const to = PROJECT_STATES[Number(a.to)]!;
      await tx.project.update({
        where: { projectIdOnchain: a.projectId },
        data: { state: to, ...(to === "FUNDED" ? { fundedAtBlock: e.blockNumber } : {}) },
      });
      await tx.projectStateChange.create({
        data: {
          projectIdOnchain: a.projectId,
          fromState: from,
          toState: to,
          reasonHash: a.reasonHash,
          actor: lc(a.actor),
          blockNumber: e.blockNumber,
          txHash: e.txHash,
          eventId: e.id,
        },
      });
      return;
    }
    case "OperatingTermSet":
      await tx.project.update({ where: { projectIdOnchain: a.projectId }, data: { termDays: Number(a.termDays) } });
      return;
    case "OperatingStarted":
      await tx.project.update({
        where: { projectIdOnchain: a.projectId },
        data: { operatingStartedAt: new Date(Number(a.startedAt) * 1000) },
      });
      return;
    case "ProjectContractsLinked":
      await tx.project.update({
        where: { projectIdOnchain: a.projectId },
        data: {
          tokenAddress: lc(a.token),
          offeringAddress: lc(a.offering),
          distributorAddress: lc(a.distributor),
          // Absent on events stored before tiers were recorded: those distributors use the legacy tiers.
          ...(Array.isArray(a.tiers) ? { feeTiers: a.tiers } : {}),
        },
      });
      for (const [kind, address] of [
        ["TOKEN", a.token],
        ["OFFERING", a.offering],
        ["DISTRIBUTOR", a.distributor],
      ] as const) {
        await tx.contractDeployment.upsert({
          where: { chainId_address: { chainId: e.chainId, address: lc(address) } },
          create: { chainId: e.chainId, address: lc(address), kind, projectId: a.projectId, deployedBlock: e.blockNumber },
          update: {},
        });
      }
      return;

    // ------------------------------------------------------------ audit registry
    case "RecordSubmitted": {
      const r = a.record as Args; // enriched at ingest with getRecord() at this block
      await tx.auditRecord.create({
        data: {
          recordIdOnchain: a.recordId,
          projectIdOnchain: a.projectId,
          kind: RECORD_KINDS[Number(a.kind)]!,
          status: "SUBMITTED",
          contentHash: a.contentHash,
          docType: a.docType,
          version: Number(a.version),
          supersedes: a.supersedes === `0x${"0".repeat(64)}` ? null : a.supersedes,
          periodStart: BigInt(r.periodStart),
          periodEnd: BigInt(r.periodEnd),
          distributableAmount: r.distributableAmount,
          paymentToken: lc(r.paymentToken),
          submitter: lc(a.submitter),
          submittedBlock: e.blockNumber,
        },
      });
      await tx.financialReport.updateMany({
        where: { projectIdOnchain: a.projectId, canonicalHash: a.contentHash, recordIdOnchain: null },
        data: { recordIdOnchain: a.recordId },
      });
      return;
    }
    case "RecordApproved":
    case "RecordRejected": {
      const status = e.name === "RecordApproved" ? "APPROVED" : "REJECTED";
      await tx.auditRecord.update({
        where: { recordIdOnchain: a.recordId },
        data: { status, reviewer: lc(a.reviewer) },
      });
      await tx.financialReport.updateMany({ where: { recordIdOnchain: a.recordId }, data: { status } });
      return;
    }
    case "RecordSuperseded":
      await tx.auditRecord.update({
        where: { recordIdOnchain: a.recordId },
        data: { status: "SUPERSEDED", supersededBy: a.supersededBy },
      });
      await tx.financialReport.updateMany({ where: { recordIdOnchain: a.recordId }, data: { status: "SUPERSEDED" } });
      return;

    // ------------------------------------------------------------ offering
    case "OfferingConfigured": {
      const c = a.config as Args;
      const pid = e.projectId!;
      const data = {
        unitPrice: c.unitPrice,
        minUnits: Number(c.minUnits),
        maxUnits: Number(c.maxUnits),
        perWalletMax: Number(c.perWalletMax),
        startAt: new Date(Number(c.startTime) * 1000),
        endAt: new Date(Number(c.endTime) * 1000),
        treasury: lc(c.treasury),
        termsHash: c.termsHash,
      };
      await tx.offering.upsert({
        where: { projectIdOnchain: pid },
        create: { projectIdOnchain: pid, address: lc(e.address), status: "CONFIGURED", ...data },
        update: data,
      });
      return;
    }
    case "OfferingOpened":
      await tx.offering.update({ where: { projectIdOnchain: e.projectId! }, data: { status: "OPEN" } });
      return;
    case "Subscribed": {
      const key = { projectIdOnchain: e.projectId!, wallet: lc(a.investor) };
      await tx.subscription.upsert({
        where: { projectIdOnchain_wallet: key },
        create: { ...key, units: Number(a.units), amount: a.amount, status: "ESCROWED", lastTxHash: e.txHash },
        update: { units: { increment: Number(a.units) }, amount: { increment: a.amount }, lastTxHash: e.txHash },
      });
      await tx.offering.update({
        where: { projectIdOnchain: e.projectId! },
        data: { unitsSold: { increment: Number(a.units) } },
      });
      return;
    }
    case "SubscriberExcluded": {
      const key = { projectIdOnchain: e.projectId!, wallet: lc(a.investor) };
      const sub = await tx.subscription.update({
        where: { projectIdOnchain_wallet: key },
        data: { status: "REFUNDABLE", lastTxHash: e.txHash },
      });
      await tx.offering.update({
        where: { projectIdOnchain: e.projectId! },
        data: { unitsSold: { decrement: sub.units } },
      });
      return;
    }
    case "OfferingSettled":
      await tx.offering.update({
        where: { projectIdOnchain: e.projectId! },
        data: { status: "SETTLED", unitsSold: Number(a.unitsSold), proceeds: a.proceeds },
      });
      await tx.subscription.updateMany({
        where: { projectIdOnchain: e.projectId!, status: "ESCROWED" },
        data: { status: "SETTLED" },
      });
      return;
    case "OfferingFailed":
    case "OfferingCancelled":
      await tx.offering.update({
        where: { projectIdOnchain: e.projectId! },
        data: { status: e.name === "OfferingFailed" ? "FAILED" : "CANCELLED" },
      });
      await tx.subscription.updateMany({
        where: { projectIdOnchain: e.projectId!, status: "ESCROWED" },
        data: { status: "REFUNDABLE" },
      });
      return;
    case "RefundClaimed":
      await tx.subscription.update({
        where: { projectIdOnchain_wallet: { projectIdOnchain: e.projectId!, wallet: lc(a.investor) } },
        data: { status: "REFUNDED", lastTxHash: e.txHash },
      });
      return;

    // ------------------------------------------------------------ share token
    case "Transfer": {
      if (e.kind !== "TOKEN") return;
      const units = Number(a.value);
      const from = lc(a.from);
      const to = lc(a.to);
      await tx.tokenTransfer.create({
        data: {
          projectIdOnchain: e.projectId!,
          fromAddress: from,
          toAddress: to,
          units,
          kind: from === ZERO ? "MINT" : "TRANSFER",
          blockNumber: e.blockNumber,
          logIndex: e.logIndex,
          txHash: e.txHash,
          eventId: e.id,
        },
      });
      if (from !== ZERO) await addHolding(tx, e.projectId!, from, -units, e.blockNumber);
      if (to !== ZERO) await addHolding(tx, e.projectId!, to, units, e.blockNumber);
      return;
    }

    // ------------------------------------------------------------ distributor
    case "AllocationRecorded": {
      // Emitted before BatchProposed in the same transaction, so make sure the batch row exists.
      await ensureBatch(tx, e);
      await tx.distributionAllocation.create({
        data: {
          projectIdOnchain: e.projectId!,
          batchIdOnchain: Number(a.batchId),
          wallet: lc(a.holder),
          units: Number(a.units),
          gross: a.gross,
          feeBps: Number(a.feeBps),
          net: a.net,
        },
      });
      return;
    }
    case "BatchProposed":
      await ensureBatch(tx, e);
      await tx.distributionBatch.update({
        where: { projectIdOnchain_batchIdOnchain: { projectIdOnchain: e.projectId!, batchIdOnchain: Number(a.batchId) } },
        data: {
          reportId: a.reportId,
          amount: a.amount,
          pool: a.pool,
          totalNet: a.totalNet,
          totalFee: a.totalFee,
          dustOut: a.dustOut,
          snapshotBlock: BigInt(a.snapshotBlock),
        },
      });
      return;
    case "CapitalReturnProposed":
      // Emitted after BatchProposed in the same transaction.
      await ensureBatch(tx, e);
      await tx.distributionBatch.update({
        where: { projectIdOnchain_batchIdOnchain: { projectIdOnchain: e.projectId!, batchIdOnchain: Number(a.batchId) } },
        data: { capitalReturn: true },
      });
      return;
    case "BatchApproved":
    case "BatchRejected":
      await tx.distributionBatch.update({
        where: { projectIdOnchain_batchIdOnchain: { projectIdOnchain: e.projectId!, batchIdOnchain: Number(a.batchId) } },
        data:
          e.name === "BatchApproved"
            ? { status: "CLAIMABLE", approver: lc(a.approver), approveTxHash: e.txHash }
            : { status: "REJECTED", approver: lc(a.reviewer), approveTxHash: e.txHash },
      });
      // The platform fee is paid out at approval, so that is when referrers earn their share.
      if (e.name === "BatchApproved") await accrueReferralRewards(tx, e, Number(a.batchId));
      return;
    case "Claimed":
      await tx.distributionAllocation.update({
        where: {
          projectIdOnchain_batchIdOnchain_wallet: {
            projectIdOnchain: e.projectId!,
            batchIdOnchain: Number(a.batchId),
            wallet: lc(a.holder),
          },
        },
        data: { claimed: true, claimTxHash: e.txHash },
      });
      return;

    // ------------------------------------------------------------ referrals (REFERRAL_DESIGN.md)
    case "ReferralBound":
      await tx.referral.create({
        data: {
          referee: lc(a.investor),
          referrer: lc(a.referrer),
          shareBps: Number(a.shareBps),
          expiresAt: new Date(Number(a.expiresAt) * 1000),
          boundBlock: e.blockNumber,
          boundTxHash: e.txHash,
        },
      });
      return;
    case "ReferralRootSet":
      await tx.referralRoot.create({
        data: {
          epoch: Number(a.epoch),
          root: lc(a.root),
          dataHash: lc(a.dataHash),
          totalCumulative: a.totalCumulative,
          blockNumber: e.blockNumber,
          txHash: e.txHash,
        },
      });
      return;
    case "ReferralRewardClaimed":
      await tx.referralClaim.upsert({
        where: { account: lc(a.account) },
        create: { account: lc(a.account), claimed: a.cumulative, lastTxHash: e.txHash },
        update: { claimed: a.cumulative, lastTxHash: e.txHash },
      });
      return;

    default:
      // Events with no read model (Approval, Paused, MinterBound, DustCarried, ...) stay in chain.event only.
      return;
  }
}

async function setFrozen(tx: Tx, wallet: string, block: bigint, frozen: boolean) {
  const status = frozen ? "FROZEN" : "NONE";
  await tx.eligibility.upsert({
    where: { wallet: lc(wallet) },
    create: { wallet: lc(wallet), lastBlock: block, status },
    update: { lastBlock: block, status },
  });
}

async function addHolding(tx: Tx, projectId: string, wallet: string, delta: number, block: bigint) {
  const key = { projectIdOnchain: projectId, wallet };
  const h = await tx.holding.upsert({
    where: { projectIdOnchain_wallet: key },
    create: { ...key, units: delta, lastBlock: block },
    update: { units: { increment: delta }, lastBlock: block },
  });
  if (h.units < 0) throw new Error(`negative holding for ${wallet} in ${projectId}`);
  if (h.units === 0) await tx.holding.delete({ where: { projectIdOnchain_wallet: key } });
}

async function ensureBatch(tx: Tx, e: StoredEvent) {
  const key = { projectIdOnchain: e.projectId!, batchIdOnchain: Number(e.args.batchId) };
  await tx.distributionBatch.upsert({
    where: { projectIdOnchain_batchIdOnchain: key },
    create: {
      ...key,
      reportId: "",
      amount: "0",
      pool: "0",
      totalNet: "0",
      totalFee: "0",
      dustOut: "0",
      snapshotBlock: 0n,
      status: "PROPOSED",
      proposeTxHash: e.txHash,
    },
    update: {},
  });
}

/**
 * Accrues promotion rewards on each referee allocation in this batch (REFERRAL_DESIGN.md §10): the
 * referee's referrer and the two wallets above earn 10% / 5% / 3% of the referee's gross allocation,
 * paid from the platform fee and capped by it. All levels use the referee's binding window; a level is
 * skipped (not passed up) when its receiver is frozen at approval time. Nobody above the third level
 * earns anything.
 */
async function accrueReferralRewards(tx: Tx, e: StoredEvent, batchId: number) {
  const allocations = await tx.distributionAllocation.findMany({
    where: { projectIdOnchain: e.projectId!, batchIdOnchain: batchId },
  });
  if (allocations.length === 0) return;
  const referrals = await tx.referral.findMany({ where: { referee: { in: allocations.map((x) => x.wallet) } } });
  if (referrals.length === 0) return;
  const block = await tx.chainBlock.findUnique({ where: { chainId_number: { chainId: e.chainId, number: e.blockNumber } } });
  if (!block) throw new Error(`block ${e.blockNumber} not stored before BatchApproved`);
  const at = block.timestamp.getTime();
  const byReferee = new Map(referrals.map((r) => [r.referee, r]));
  // Referrers of the referrers, two steps up.
  const upline = new Map<string, string>();
  let frontier = [...new Set(referrals.map((r) => r.referrer))];
  for (let step = 1; step < REFERRAL_LEVEL_BPS.length && frontier.length > 0; step++) {
    const rows = await tx.referral.findMany({ where: { referee: { in: frontier.filter((w) => !upline.has(w)) } } });
    for (const r of rows) upline.set(r.referee, r.referrer);
    frontier = rows.map((r) => r.referrer);
  }
  const frozen = async (wallet: string) => (await tx.eligibility.findUnique({ where: { wallet } }))?.status === "FROZEN";
  for (const alloc of allocations) {
    const ref = byReferee.get(alloc.wallet);
    if (!ref || ref.expiresAt.getTime() <= at) continue;
    const gross = BigInt(alloc.gross.toFixed());
    const fee = gross - BigInt(alloc.net.toFixed());
    const rewards = referralRewards(gross, fee);
    let receiver: string | undefined = ref.referrer;
    for (let i = 0; i < REFERRAL_LEVEL_BPS.length && receiver; i++, receiver = upline.get(receiver!)) {
      // The contract makes cycles impossible; never pay the referee their own reward if a projection were wrong.
      if (receiver === alloc.wallet || rewards[i] === 0n || (await frozen(receiver))) continue;
      await tx.referralAccrual.create({
        data: {
          projectIdOnchain: alloc.projectIdOnchain,
          batchIdOnchain: batchId,
          referee: alloc.wallet,
          level: i + 1,
          referrer: receiver,
          gross: gross.toString(),
          fee: fee.toString(),
          shareBps: REFERRAL_LEVEL_BPS[i]!,
          reward: rewards[i]!.toString(),
        },
      });
    }
  }
}

/** Deletes every chain-derived read model and replays chain.event in order. */
export async function rebuildProjections(prisma: PrismaClient, chainId: number): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      await tx.referralAccrual.deleteMany({});
      await tx.referral.deleteMany({});
      await tx.referralRoot.deleteMany({});
      await tx.referralClaim.deleteMany({});
      await tx.distributionAllocation.deleteMany({});
      await tx.distributionBatch.deleteMany({});
      await tx.holding.deleteMany({});
      await tx.tokenTransfer.deleteMany({});
      await tx.subscription.deleteMany({});
      await tx.offering.deleteMany({});
      await tx.projectStateChange.deleteMany({});
      await tx.project.deleteMany({});
      await tx.auditRecord.deleteMany({});
      await tx.eligibility.deleteMany({});
      await tx.roleGrant.deleteMany({ where: { chainId } });
      await tx.contractDeployment.deleteMany({ where: { chainId, projectId: { not: null } } });
      await tx.financialReport.updateMany({ data: { recordIdOnchain: null, status: "SUBMITTED" } });

      await restoreRecoveryBaseline(tx, chainId);
      const singletons = await tx.contractDeployment.findMany({ where: { chainId } });
      const kinds = new Map(singletons.map((d) => [d.address, { kind: d.kind as ContractKind, projectId: d.projectId }]));
      const events = await tx.chainEvent.findMany({
        where: { chainId },
        orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      });
      // Project contracts emit events (e.g. constructor RoleGranted) before ProjectContractsLinked in
      // the same transaction, so learn every link first.
      for (const ev of events) {
        if (ev.name !== "ProjectContractsLinked") continue;
        const a = ev.args as Args;
        for (const [kind, addr] of [
          ["TOKEN", a.token],
          ["OFFERING", a.offering],
          ["DISTRIBUTOR", a.distributor],
        ] as const) {
          kinds.set(lc(addr), { kind, projectId: a.projectId });
        }
      }
      for (const ev of events) {
        const meta = kinds.get(ev.address);
        if (!meta) throw new Error(`event from unknown contract ${ev.address}`);
        await applyEvent(tx, { ...ev, args: ev.args as Args, kind: meta.kind, projectId: meta.projectId });
      }
      return events.length;
    },
    { timeout: 120_000 },
  );
}
