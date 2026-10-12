import { describe, expect, it } from "vitest";
import { blockReason, settleReady } from "@/components/SubscribePanel";

const ok = { connected: true, signedIn: true, open: true, frozen: false, remaining: 40, units: 3, balance: 10_000n, cost: 1_500n, acknowledged: true };

describe("subscribe gating", () => {
  it("allows a signed-in investor with funds who accepted the risks", () => {
    expect(blockReason(ok)).toBeNull();
  });

  it("explains the first thing to fix, in order", () => {
    expect(blockReason({ ...ok, open: false })).toBe("当前不在募集期");
    expect(blockReason({ ...ok, connected: false })).toBe("请先连接钱包");
    expect(blockReason({ ...ok, signedIn: false })).toBe("请先签名登录");
    expect(blockReason({ ...ok, frozen: true })).toBe("该钱包已被冻结，暂时无法交易");
    expect(blockReason({ ...ok, remaining: 0 })).toMatch(/上限|售罄/);
    expect(blockReason({ ...ok, units: 41 })).toBe("可认购 1–40 份");
    expect(blockReason({ ...ok, balance: 1_000n })).toBe("USDT 余额不足");
    expect(blockReason({ ...ok, native: 0n })).toMatch(/BNB/);
    expect(blockReason({ ...ok, acknowledged: false })).toBe("请先勾选确认");
  });

  it("says when a not-yet-open offering starts", () => {
    expect(blockReason({ ...ok, open: false, opensAt: "2026-10-12 03:06" })).toBe("2026-10-12 03:06 开放认购");
  });

  it("does not block while the freeze status or balance are still loading", () => {
    expect(blockReason({ ...ok, frozen: undefined, balance: undefined })).toBeNull();
  });
});

describe("settleReady", () => {
  const o = { status: "OPEN", unitsSold: 100, minUnits: 10, maxUnits: 100, endAt: "2026-11-26T00:00:00Z" };
  const before = new Date("2026-11-01T00:00:00Z").getTime();
  const after = new Date("2026-11-27T00:00:00Z").getTime();
  it("is ready as soon as the offering is sold out", () => expect(settleReady(o, before)).toBe(true));
  it("waits for the deadline when not sold out", () => {
    expect(settleReady({ ...o, unitsSold: 50 }, before)).toBe(false);
    expect(settleReady({ ...o, unitsSold: 50 }, after)).toBe(true);
  });
  it("never settles below the minimum or twice", () => {
    expect(settleReady({ ...o, unitsSold: 5 }, after)).toBe(false);
    expect(settleReady({ ...o, status: "SETTLED" }, after)).toBe(false);
  });
});
