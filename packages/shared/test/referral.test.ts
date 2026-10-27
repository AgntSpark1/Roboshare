import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildReferralTree, referralLeaf, referralReward, referralRewards, verifyReferralProof } from "../src/referral.js";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;

describe("referral rewards", () => {
  it("takes the share of the platform fee, rounding down", () => {
    expect(referralReward(80n, 2_000)).toBe(16n);
    expect(referralReward(7n, 2_000)).toBe(1n);
    expect(referralReward(0n, 2_000)).toBe(0n);
    expect(() => referralReward(1n, 10_001)).toThrow();
    expect(() => referralReward(-1n, 2_000)).toThrow();
  });

  it("matches the Solidity leaf encoding", () => {
    // cast keccak $(cast keccak $(cast abi-encode "f(address,uint256)" 0x…A1 1e18))
    expect(referralLeaf(addr(0xa1), 10n ** 18n)).toBe("0x98518aa156408a5e27f6a43ef829a5b5199d6297982abc99af2b92b847237181");
  });

  it("produces a proof for every entry and rejects tampering", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 40 }), (ids) => {
        const t = buildReferralTree(ids.map((n) => ({ account: addr(n), cumulative: BigInt(n) * 7n })));
        for (const e of t.entries) {
          expect(verifyReferralProof(t.root, e.account, e.cumulative, e.proof)).toBe(true);
          expect(verifyReferralProof(t.root, e.account, e.cumulative + 1n, e.proof)).toBe(false);
        }
        expect(t.totalCumulative).toBe(ids.reduce((s, n) => s + BigInt(n) * 7n, 0n));
      }),
      { numRuns: 200 },
    );
  });

  it("root does not depend on input order", () => {
    const xs = [1, 2, 3, 4, 5].map((n) => ({ account: addr(n), cumulative: BigInt(n) }));
    expect(buildReferralTree(xs).root).toBe(buildReferralTree([...xs].reverse()).root);
  });

  it("rejects empty, duplicate and zero entries", () => {
    expect(() => buildReferralTree([])).toThrow();
    expect(() => buildReferralTree([{ account: addr(1), cumulative: 1n }, { account: addr(1), cumulative: 2n }])).toThrow();
    expect(() => buildReferralTree([{ account: addr(1), cumulative: 0n }])).toThrow();
  });
});

describe("three-level rewards", () => {
  it("pays 10% / 5% / 3% of the referee's gross out of the 30% platform share", () => {
    // 1000 gross, 300 platform share: 100 + 50 + 30, the platform keeps 120.
    expect(referralRewards(1_000n, 300n)).toEqual([100n, 50n, 30n]);
  });

  it("never pays more than the platform fee on a legacy low-fee project", () => {
    // 7.5% legacy tier: the 75 fee only covers part of level 1.
    expect(referralRewards(1_000n, 75n)).toEqual([75n, 0n, 0n]);
    expect(referralRewards(1_000n, 120n)).toEqual([100n, 20n, 0n]);
    expect(referralRewards(1_000n, 0n)).toEqual([0n, 0n, 0n]);
  });
});
