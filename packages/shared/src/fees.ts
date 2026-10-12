/**
 * TypeScript mirror of FeeTiers.sol and RevenueDistributor allocation math.
 * Used for previews only; the contract is the source of truth.
 */
export const BPS_DENOMINATOR = 10_000n;

export interface FeeTier {
  minUnits: number;
  bps: number;
}

/** TOKENOMICS §3: 1-4 units 20%, 5-9 17.5%, 10-19 15%, 20-49 12.5%, 50+ 10%. */
export const DEFAULT_TIERS: readonly FeeTier[] = [
  { minUnits: 1, bps: 2000 },
  { minUnits: 5, bps: 1750 },
  { minUnits: 10, bps: 1500 },
  { minUnits: 20, bps: 1250 },
  { minUnits: 50, bps: 1000 },
];

/** Mirrors FeeTiers.sol: projects with a term of at least LONG_TERM_DAYS pay LONG_TERM_DISCOUNT_BPS less on every tier. */
export const DEFAULT_TERM_DAYS = 720;
export const LONG_TERM_DAYS = 720;
export const LONG_TERM_DISCOUNT_BPS = 250;

export function tiersForTerm(termDays: number | null | undefined): readonly FeeTier[] {
  const days = termDays || DEFAULT_TERM_DAYS;
  return days >= LONG_TERM_DAYS ? DEFAULT_TIERS.map((t) => ({ ...t, bps: t.bps - LONG_TERM_DISCOUNT_BPS })) : DEFAULT_TIERS;
}

export function tierBpsFor(units: number, tiers: readonly FeeTier[] = DEFAULT_TIERS): number {
  if (!Number.isInteger(units) || units <= 0) throw new RangeError("units must be a positive integer");
  let bps: number | undefined;
  for (const t of tiers) {
    if (units >= t.minUnits) bps = t.bps;
  }
  if (bps === undefined) throw new RangeError(`no tier for ${units} units`);
  return bps;
}

export interface HolderUnits {
  address: string;
  units: number;
}

export interface Allocation extends HolderUnits {
  gross: bigint;
  feeBps: number;
  fee: bigint;
  net: bigint;
}

export interface AllocationResult {
  pool: bigint;
  allocations: Allocation[];
  totalNet: bigint;
  totalFee: bigint;
  dustOut: bigint;
}

/**
 * Mirrors RevenueDistributor._allocate: gross = floor(pool * units / supply),
 * fee = floor(gross * bps / 10000), net = gross - fee, dust = pool - sum(gross).
 */
export function allocate(
  amount: bigint,
  carriedDust: bigint,
  holders: readonly HolderUnits[],
  tiers: readonly FeeTier[] = DEFAULT_TIERS,
): AllocationResult {
  if (amount <= 0n) throw new RangeError("amount must be positive");
  if (carriedDust < 0n) throw new RangeError("carriedDust must be non-negative");
  const supply = holders.reduce((s, h) => s + BigInt(h.units), 0n);
  if (supply === 0n) throw new RangeError("holders hold no units");
  const pool = amount + carriedDust;
  let totalGross = 0n;
  let totalNet = 0n;
  const allocations = holders.map((h) => {
    const gross = (pool * BigInt(h.units)) / supply;
    const feeBps = tierBpsFor(h.units, tiers);
    const fee = (gross * BigInt(feeBps)) / BPS_DENOMINATOR;
    const net = gross - fee;
    totalGross += gross;
    totalNet += net;
    return { ...h, gross, feeBps, fee, net };
  });
  return { pool, allocations, totalNet, totalFee: totalGross - totalNet, dustOut: pool - totalGross };
}
