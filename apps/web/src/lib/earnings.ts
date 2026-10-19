import type { DailyRevenueItem } from "@roboshare/ui";
import { BPS_DENOMINATOR, tierBpsFor, type FeeTier } from "@roboshare/shared";

export interface DailyEarning {
  day: string;
  /** The holder's estimated share after the platform fee, in USDT base units. */
  amount: bigint;
  pending: boolean;
}

/**
 * A holder's estimated share of each day's net operating income: units / issued units, less the fee tier that
 * will apply at the monthly distribution. Linear per day, so the days of a month add up to that month's estimate.
 */
export function holderDaily(items: readonly DailyRevenueItem[], units: number, issuedUnits: number, tiers: readonly FeeTier[]): DailyEarning[] {
  if (units <= 0 || issuedUnits <= 0) return [];
  let bps = 0;
  try {
    bps = tierBpsFor(units, tiers);
  } catch {
    bps = 0;
  }
  const keep = BPS_DENOMINATOR - BigInt(bps);
  return items.map((d) => ({
    day: d.day,
    amount: (BigInt(d.net) * BigInt(units) * keep) / (BigInt(issuedUnits) * BPS_DENOMINATOR),
    pending: d.status === "PENDING",
  }));
}

/** Adds several holdings' daily earnings by date, newest first. A day is pending if any part of it is. */
export function sumByDay(lists: readonly DailyEarning[][]): DailyEarning[] {
  const byDay = new Map<string, DailyEarning>();
  for (const list of lists) {
    for (const e of list) {
      const cur = byDay.get(e.day);
      byDay.set(e.day, cur ? { day: e.day, amount: cur.amount + e.amount, pending: cur.pending || e.pending } : { ...e });
    }
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/** Total of the days not yet paid out. */
export function pendingTotal(days: readonly DailyEarning[]): bigint {
  return days.filter((d) => d.pending).reduce((s, d) => s + d.amount, 0n);
}
