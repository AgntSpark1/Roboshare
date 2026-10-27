/**
 * City reward (REFERRAL_DESIGN.md §11): a team leader earns 1 USDT for every 100 USDT of new units their
 * team's investors buy, once those units have been held for a month. Counted once per mint, paid after the
 * monthly settlement day through the same ReferralRewards claim, from the platform's own funds, until the
 * programme total is used up. Never paid from any investor's share.
 */

/** USDT base units (18 decimals on BSC). */
const ONE = 10n ** 18n;

/** Reward per "份" of 100 USDT invested: 1 USDT, i.e. 1% of the invested amount. */
export const CITY_REWARD_UNIT = 100n * ONE;
export const CITY_REWARD_PER_UNIT = 1n * ONE;
/** The whole programme: 100,000 份 = 100,000 USDT, then it ends. */
export const CITY_REWARD_CAP = 100_000n * ONE;
/** Units must be held this long after they were issued. */
export const CITY_REWARD_HOLD_DAYS = 30;

/** One issuance of units to an investor (a share-token mint), oldest first. */
export interface CityMint {
  id: string;
  projectId: string;
  wallet: string;
  units: number;
  unitPrice: bigint;
  mintedAt: Date;
}

export interface CityRewardRow {
  mintId: string;
  projectId: string;
  wallet: string;
  leader: string;
  mintedUnits: number;
  /** Units still held when counted; units sold before the holding month ends earn nothing. */
  units: number;
  reward: bigint;
}

export const cityReward = (units: number, unitPrice: bigint) => (BigInt(units) * unitPrice * CITY_REWARD_PER_UNIT) / CITY_REWARD_UNIT;

/**
 * Settles every mint that has completed its holding month and was not counted before.
 * - mints: uncounted mints since the programme start, in mint order;
 * - leaderOf: the team leader of each wallet now (none = no team, the mint waits);
 * - held: units each wallet holds now per project ("project:wallet");
 * - paid: total city reward already accrued, for the cap.
 * A mint of a wallet with no team, or under a frozen leader, is left for a later month; a leader's own
 * purchases never count. Each wallet's holding is used once across its mints, oldest first.
 */
export function planCityRewards(
  mints: CityMint[],
  opts: { now: Date; leaderOf: (wallet: string) => string | undefined; frozen: (wallet: string) => boolean; held: Map<string, number>; paid: bigint },
): CityRewardRow[] {
  const due = opts.now.getTime() - CITY_REWARD_HOLD_DAYS * 86_400_000;
  const left = new Map(opts.held);
  let remaining = CITY_REWARD_CAP - opts.paid;
  const rows: CityRewardRow[] = [];
  for (const m of mints) {
    if (remaining <= 0n) break;
    if (m.mintedAt.getTime() > due) continue;
    const leader = opts.leaderOf(m.wallet);
    if (!leader || leader === m.wallet || opts.frozen(leader)) continue;
    const key = `${m.projectId}:${m.wallet}`;
    const units = Math.min(m.units, left.get(key) ?? 0);
    left.set(key, (left.get(key) ?? 0) - units);
    let reward = cityReward(units, m.unitPrice);
    if (reward > remaining) reward = remaining;
    remaining -= reward;
    rows.push({ mintId: m.id, projectId: m.projectId, wallet: m.wallet, leader, mintedUnits: m.units, units, reward });
  }
  return rows;
}
