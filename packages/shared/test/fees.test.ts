import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate, legacyTiersForTerm, LEGACY_TIERS, projectTiers, tierBpsFor, tiersForTerm } from "../src/fees.js";

const ONE = 10n ** 18n;

describe("tierBpsFor", () => {
  it("charges new projects a flat 30% like FeeTiers.sol", () => {
    for (const u of [1, 9, 50, 100]) expect(tierBpsFor(u)).toBe(3000);
    expect(tiersForTerm(180)).toEqual(tiersForTerm(720));
  });

  it("keeps the legacy boundaries for projects deployed before the change", () => {
    const cases: [number, number][] = [
      [1, 2000], [4, 2000], [5, 1750], [9, 1750], [10, 1500],
      [19, 1500], [20, 1250], [49, 1250], [50, 1000], [100, 1000],
    ];
    for (const [u, bps] of cases) expect(tierBpsFor(u, LEGACY_TIERS)).toBe(bps);
    expect(tierBpsFor(1, legacyTiersForTerm(720))).toBe(1750);
  });

  it("picks recorded tiers, then legacy for an already linked distributor, then the default", () => {
    expect(projectTiers({ feeTiers: [{ minUnits: 1, bps: 1234 }], distributorAddress: "0x1" })).toEqual([{ minUnits: 1, bps: 1234 }]);
    expect(projectTiers({ feeTiers: null, distributorAddress: "0x1", termDays: 180 })).toEqual(LEGACY_TIERS);
    expect(projectTiers({ distributorAddress: null })).toEqual(tiersForTerm(720));
  });
});

describe("allocate", () => {
  // Same vectors as RevenueDistributor.t.sol test_TokenomicsWorkedExample.
  it("reproduces the contract's worked example", () => {
    const units = [50, 25, 10, 9, 4, 2];
    const r = allocate(10_000n * ONE, 0n, units.map((u, i) => ({ address: `h${i}`, units: u })));
    expect(r.allocations.map((a) => a.net)).toEqual([3_500n * ONE, 1_750n * ONE, 700n * ONE, 630n * ONE, 280n * ONE, 140n * ONE]);
    expect(r.totalNet).toBe(7_000n * ONE);
    expect(r.totalFee).toBe(3_000n * ONE);
    expect(r.dustOut).toBe(0n);
  });

  it("conserves the pool and keeps dust below the holder count", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 20 }),
        fc.bigInt({ min: 1n, max: 10n ** 33n }),
        fc.bigInt({ min: 0n, max: 100n }),
        (units, amount, dust) => {
          const r = allocate(amount, dust, units.map((u, i) => ({ address: `h${i}`, units: u })));
          expect(r.totalNet + r.totalFee + r.dustOut).toBe(r.pool);
          expect(r.dustOut < BigInt(units.length)).toBe(true);
        },
      ),
      { numRuns: 2000 },
    );
  });
});
