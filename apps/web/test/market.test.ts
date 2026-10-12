import { describe, expect, it } from "vitest";
import { buyBlockReason, sellInput } from "@/components/MarketPanel";
import { activeListings, type MarketListing } from "@/lib/market";

const ok = { frozen: false, available: 5, units: 2, balance: 10_000n, cost: 1_800n, acknowledged: true };

describe("market buy gating", () => {
  it("allows an unfrozen buyer with funds who accepted the risks", () => {
    expect(buyBlockReason(ok)).toBeNull();
  });

  it("explains the first thing to fix, in order", () => {
    expect(buyBlockReason({ ...ok, frozen: true })).toBe("该钱包已被冻结，暂时无法交易");
    expect(buyBlockReason({ ...ok, units: 6 })).toBe("可买 1–5 份");
    expect(buyBlockReason({ ...ok, balance: 1_000n })).toBe("USDT 余额不足");
    expect(buyBlockReason({ ...ok, acknowledged: false })).toBe("请先勾选确认");
  });

  it("does not block while the freeze status or balance are still loading", () => {
    expect(buyBlockReason({ ...ok, frozen: undefined, balance: undefined })).toBeNull();
  });
});

describe("market sell form", () => {
  it("parses a valid listing", () => {
    expect(sellInput(10, 3, "950.5")).toEqual({ price: 9505n * 10n ** 17n });
  });

  it("rejects bad input", () => {
    expect(sellInput(0, 1, "950")).toEqual({ error: "你没有可出售的份额" });
    expect(sellInput(10, 11, "950")).toEqual({ error: "可卖 1–10 份" });
    expect(sellInput(10, 0, "950")).toEqual({ error: "可卖 1–10 份" });
    expect(sellInput(10, 1, "")).toEqual({ error: "请输入每份价格" });
    expect(sellInput(10, 1, "0")).toEqual({ error: "请输入每份价格" });
    expect(sellInput(10, 1, "abc")).toEqual({ error: "请输入每份价格" });
  });
});

describe("active listings", () => {
  const l = (id: bigint, units: number, fillable: number): MarketListing => ({
    id,
    seller: "0x0000000000000000000000000000000000000001",
    units,
    fillable,
    pricePerUnit: 1n,
    expiresAt: 0,
  });

  it("drops sold, cancelled and unfillable listings and puts the newest first", () => {
    expect(activeListings([l(1n, 3, 3), l(2n, 0, 0), l(3n, 5, 0), l(4n, 2, 2)]).map((x) => x.id)).toEqual([4n, 1n]);
  });
});
