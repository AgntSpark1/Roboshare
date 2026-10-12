import { describe, expect, it } from "vitest";
import { nextNonce, preValidatedSignatures, safeTxTitle } from "../src/lib/safe";

const A = "0x00000000000000000000000000000000000000a1" as const;
const B = "0x00000000000000000000000000000000000000B2" as const;
const C = "0x00000000000000000000000000000000000000c3" as const;
const owners = [C, A, B];
const word = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");
const sig = (a: string) => `${word(a)}${"0".repeat(64)}01`;

describe("Safe pre-validated signatures", () => {
  it("needs the threshold, counting the executing owner", () => {
    expect(preValidatedSignatures([], A, owners, 2)).toBeNull();
    expect(preValidatedSignatures([B], undefined, owners, 2)).toBeNull();
    expect(preValidatedSignatures([A], A, owners, 2)).toBeNull(); // same owner twice is one signer
  });

  it("packs r = owner, s = 0, v = 1, owners ascending", () => {
    expect(preValidatedSignatures([C], A, owners, 2)).toBe(`0x${sig(A)}${sig(C)}`);
    expect(preValidatedSignatures([B, A], undefined, owners, 2)).toBe(`0x${sig(A)}${sig(B)}`);
  });

  it("ignores a non-owner executor and stops at the threshold", () => {
    const outsider = "0x0000000000000000000000000000000000000001";
    expect(preValidatedSignatures([B], outsider, owners, 2)).toBeNull();
    expect(preValidatedSignatures([C, B, A], undefined, owners, 2)).toBe(`0x${sig(A)}${sig(B)}`);
  });
});

describe("queue helpers", () => {
  it("takes the first nonce not used by a pending transaction", () => {
    expect(nextNonce(5, [])).toBe(5);
    expect(nextNonce(5, [{ safeNonce: 5 }, { safeNonce: null }, { safeNonce: 6 }])).toBe(7);
  });

  it("names queued transactions in Chinese", () => {
    expect(safeTxTitle("Safe batch: configure and open offering 0xabc")).toBe("开启募集");
    expect(safeTxTitle("Safe: move project 0xabc to ACTIVE")).toBe("项目状态改为：投入运营");
    expect(safeTxTitle("Safe batch: referral terms off")).toBe("关闭邀请奖励");
  });
});
