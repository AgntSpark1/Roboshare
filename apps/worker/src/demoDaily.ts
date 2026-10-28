import type { PrismaClient } from "@roboshare/db";
import { keccak256, stringToHex } from "viem";

/**
 * Testnet only: simulated daily operating figures for vehicles in operation, so the site's daily income and the
 * monthly autopilot can be seen working without anyone typing numbers into the console. Off unless
 * DEMO_DAILY_OPS=true, and refused on BSC mainnet. Never overwrites a row someone entered.
 */
export interface DemoDailyConfig {
  chainId: number;
  utcOffsetHours: number;
  /** How many past days to fill when a vehicle has been running a while. */
  backfillDays: number;
}

export const DEMO_DAILY_AUTHOR = "testnet-simulator";

export function loadDemoDailyConfig(env: NodeJS.ProcessEnv = process.env): DemoDailyConfig | null {
  if (env.DEMO_DAILY_OPS !== "true") return null;
  const chainId = Number(env.CHAIN_ID);
  if (chainId === 56) throw new Error("DEMO_DAILY_OPS is for testnets only");
  return { chainId, utcOffsetHours: Number(env.AUTOPILOT_UTC_OFFSET_HOURS ?? 8), backfillDays: Number(env.DEMO_DAILY_BACKFILL_DAYS ?? 31) };
}

/** Local calendar dates (YYYY-MM-DD) from the day operations started through yesterday, at most `backfill` of them. */
export function daysToFill(startedAt: Date, now: Date, utcOffsetHours: number, backfill: number): string[] {
  const offset = utcOffsetHours * 3600_000;
  const day = (t: Date) => new Date(t.getTime() + offset).toISOString().slice(0, 10);
  const first = day(startedAt);
  const out: string[] = [];
  for (let i = 1; i <= backfill; i++) {
    const d = day(new Date(now.getTime() - i * 86_400_000));
    if (d < first) break;
    out.push(d);
  }
  return out;
}

/**
 * One day's figures, repeatable for the same vehicle and date. Scaled to the money raised: revenue about
 * 0.35–0.55% of it a day, costs 35–50% of revenue (TOKENOMICS illustrative range, not a promise).
 */
export function simulateDay(projectId: string, day: string, raised: bigint) {
  const h = BigInt(keccak256(stringToHex(`${projectId}:${day}`)));
  const pick = (shift: bigint, lo: bigint, span: bigint) => lo + ((h >> shift) % span);
  const revenue = (raised * pick(0n, 35n, 21n)) / 10_000n;
  const expenses = (revenue * pick(16n, 35n, 16n)) / 100n;
  const rides = Number(pick(32n, 18n, 23n));
  return { revenue, expenses, rides };
}

export async function runDemoDaily(prisma: PrismaClient, cfg: DemoDailyConfig, now = new Date()) {
  const running = await prisma.project.findMany({
    where: { state: "ACTIVE", operatingStartedAt: { not: null } },
    include: { offering: true },
  });
  let added = 0;
  for (const p of running) {
    const o = p.offering;
    const raised = o?.proceeds ? BigInt(o.proceeds.toFixed()) : o ? BigInt(o.unitPrice.toFixed()) * BigInt(o.unitsSold) : 0n;
    if (raised === 0n) continue;
    const days = daysToFill(p.operatingStartedAt!, now, cfg.utcOffsetHours, cfg.backfillDays);
    if (!days.length) continue;
    const res = await prisma.dailyOperating.createMany({
      data: days.map((d) => {
        const s = simulateDay(p.projectIdOnchain, d, raised);
        return {
          projectIdOnchain: p.projectIdOnchain,
          day: new Date(`${d}T00:00:00.000Z`),
          revenue: s.revenue.toString(),
          expenses: s.expenses.toString(),
          rides: s.rides,
          note: "测试网模拟数据",
          enteredBy: DEMO_DAILY_AUTHOR,
        };
      }),
      skipDuplicates: true,
    });
    added += res.count;
  }
  return { projects: running.length, added };
}
