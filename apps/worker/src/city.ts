import type { PrismaClient } from "@roboshare/db";
import { CITY_REWARD_HOLD_DAYS, planCityRewards, placeInTeams, type CityMint } from "@roboshare/shared";

/**
 * City reward (REFERRAL_DESIGN.md §11). Off unless CITY_REWARD_START (ISO date) is set: only units issued from
 * then on are "new". Runs from the monthly settlement day (AUTOPILOT_REPORT_DAY, Beijing time) and counts the
 * mints that had completed their holding month by that day; mints that finish it later wait for next month.
 * Running again in the same month is a no-op. Only database rows change: payment goes out with the next
 * ReferralRewards root the operator publishes.
 */
export interface CityConfig {
  chainId: number;
  start: Date;
  utcOffsetHours: number;
  settlementDay: number;
}

export function loadCityConfig(env: NodeJS.ProcessEnv = process.env): CityConfig | null {
  if (!env.CITY_REWARD_START) return null;
  const start = new Date(env.CITY_REWARD_START);
  if (Number.isNaN(start.getTime())) throw new Error("CITY_REWARD_START must be an ISO date");
  return {
    chainId: Number(env.CHAIN_ID),
    start,
    utcOffsetHours: Number(env.AUTOPILOT_UTC_OFFSET_HOURS ?? 8),
    settlementDay: Number(env.AUTOPILOT_REPORT_DAY ?? 2),
  };
}

/** This month's settlement day (local midnight, as an instant) and its YYYY-MM, or null before it. */
export function settlementCutoff(now: Date, cfg: Pick<CityConfig, "utcOffsetHours" | "settlementDay">) {
  const offset = cfg.utcOffsetHours * 3600_000;
  const local = new Date(now.getTime() + offset);
  const cutoff = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), cfg.settlementDay) - offset);
  if (now < cutoff) return null;
  return { cutoff, month: local.toISOString().slice(0, 7) };
}

export async function runCityRewards(prisma: PrismaClient, cfg: CityConfig, now = new Date()) {
  const due = settlementCutoff(now, cfg);
  if (!due) return { month: null, counted: 0 };
  const latestMint = new Date(due.cutoff.getTime() - CITY_REWARD_HOLD_DAYS * 86_400_000);
  if (latestMint < cfg.start) return { month: due.month, counted: 0 };

  const [teams, bindings, counted, frozenRows] = await Promise.all([
    prisma.team.findMany({ select: { leader: true } }),
    prisma.referral.findMany({ select: { referee: true, referrer: true } }),
    prisma.cityReward.findMany({ select: { mintEventId: true, projectIdOnchain: true, wallet: true, units: true, reward: true } }),
    prisma.eligibility.findMany({ where: { status: "FROZEN" }, select: { wallet: true } }),
  ]);
  if (teams.length === 0) return { month: due.month, counted: 0 };
  const placed = placeInTeams(new Map(bindings.map((b) => [b.referee, b.referrer])), new Set(teams.map((t) => t.leader)));
  const done = new Set(counted.map((c) => c.mintEventId));

  // New units issued to team members between the programme start and the latest due mint.
  const members = [...placed].filter(([w, p]) => p.leader !== w).map(([w]) => w);
  const transfers = await prisma.tokenTransfer.findMany({ where: { kind: "MINT", toAddress: { in: members } } });
  const blocks = await prisma.chainBlock.findMany({ where: { chainId: cfg.chainId, number: { in: [...new Set(transfers.map((t) => t.blockNumber))] } } });
  const at = new Map(blocks.map((b) => [b.number, b.timestamp]));
  const prices = new Map(
    (await prisma.offering.findMany({ where: { projectIdOnchain: { in: [...new Set(transfers.map((t) => t.projectIdOnchain))] } } })).map((o) => [o.projectIdOnchain, BigInt(o.unitPrice.toFixed())]),
  );
  const mints: CityMint[] = transfers
    .filter((t) => !done.has(t.eventId) && at.has(t.blockNumber) && prices.has(t.projectIdOnchain))
    .map((t) => ({ id: t.eventId, projectId: t.projectIdOnchain, wallet: t.toAddress, units: t.units, unitPrice: prices.get(t.projectIdOnchain)!, mintedAt: at.get(t.blockNumber)! }))
    .filter((m) => m.mintedAt >= cfg.start && m.mintedAt <= latestMint)
    .sort((a, b) => a.mintedAt.getTime() - b.mintedAt.getTime() || a.id.localeCompare(b.id));
  if (mints.length === 0) return { month: due.month, counted: 0 };

  // Units held now, less those already counted for earlier mints of the same wallet and project.
  const holdings = await prisma.holding.findMany({ where: { wallet: { in: [...new Set(mints.map((m) => m.wallet))] } } });
  const held = new Map(holdings.map((h) => [`${h.projectIdOnchain}:${h.wallet}`, h.units]));
  for (const c of counted) {
    const key = `${c.projectIdOnchain}:${c.wallet}`;
    if (held.has(key)) held.set(key, Math.max(0, held.get(key)! - c.units));
  }
  const frozen = new Set(frozenRows.map((f) => f.wallet));
  const paid = counted.reduce((s, c) => s + BigInt(c.reward.toFixed()), 0n);
  const rows = planCityRewards(mints, {
    now: due.cutoff,
    leaderOf: (w) => placed.get(w)?.leader,
    frozen: (w) => frozen.has(w),
    held,
    paid,
  });
  const at2 = new Map(mints.map((m) => [m.id, m.mintedAt]));
  await prisma.cityReward.createMany({
    data: rows.map((r) => ({
      mintEventId: r.mintId,
      projectIdOnchain: r.projectId,
      wallet: r.wallet,
      leader: r.leader,
      mintedUnits: r.mintedUnits,
      units: r.units,
      reward: r.reward.toString(),
      mintedAt: at2.get(r.mintId)!,
      month: due.month,
    })),
    skipDuplicates: true,
  });
  return { month: due.month, counted: rows.length };
}
