import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate, tierBpsFor } from "../src/fees.js";

const ONE = 10n ** 18n;

describe("tierBpsFor", () => {
  it("matches FeeTiers.sol boundaries", () => {
    const cases: [number, number][] = [
      [1, 2000], [4, 2000], [5, 1750], [9, 1750], [10, 1500],
      [19, 1500], [20, 1250], [49, 1250], [50, 1000], [100, 1000],
    ];
    for (const [u, bps] of cases) expect(tierBpsFor(u)).toBe(bps);
  });
});

describe("allocate", () => {
  // Same vectors as RevenueDistributor.t.sol test_TokenomicsWorkedExample.
  it("reproduces the TOKENOMICS §4.4 example", () => {
    const units = [50, 25, 10, 9, 4, 2];
    const r = allocate(10_000n * ONE, 0n, units.map((u, i) => ({ address: `h${i}`, units: u })));
    expect(r.allocations.map((a) => a.net)).toEqual([
      4_500n * ONE, 2_187_500n * 10n ** 15n, 850n * ONE, 742_500n * 10n ** 15n, 320n * ONE, 160n * ONE,
    ]);
    expect(r.totalNet).toBe(8_760n * ONE);
    expect(r.totalFee).toBe(1_240n * ONE);
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
