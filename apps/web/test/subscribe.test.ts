import { describe, expect, it } from "vitest";
import { blockReason } from "@/components/SubscribePanel";

const ok = { connected: true, signedIn: true, open: true, eligible: true, remaining: 40, units: 3, balance: 10_000n, cost: 1_500n, acknowledged: true };

describe("subscribe gating", () => {
  it("allows a signed-in, eligible investor with funds who accepted the risks", () => {
    expect(blockReason(ok)).toBeNull();
  });

  it("explains the first thing to fix, in order", () => {
    expect(blockReason({ ...ok, open: false })).toBe("当前不在募集期");
    expect(blockReason({ ...ok, connected: false })).toBe("请先连接钱包");
    expect(blockReason({ ...ok, signedIn: false })).toBe("请先签名登录");
    expect(blockReason({ ...ok, eligible: false })).toBe("你的钱包还没有通过投资资格认证");
    expect(blockReason({ ...ok, remaining: 0 })).toMatch(/上限|售罄/);
    expect(blockReason({ ...ok, units: 41 })).toBe("可认购 1–40 份");
    expect(blockReason({ ...ok, balance: 1_000n })).toBe("USDT 余额不足");
    expect(blockReason({ ...ok, acknowledged: false })).toBe("请先勾选风险确认");
  });

  it("does not block while eligibility or balance are still loading", () => {
    expect(blockReason({ ...ok, eligible: undefined, balance: undefined })).toBeNull();
  });
});
