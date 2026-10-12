import { describe, expect, it } from "vitest";
import { buyBlockReason, listingStatus, sellInput } from "@/components/MarketPanel";
import { activeListings, browseListings, premiumPct, type MarketListing } from "@/lib/market";

const ok = { eligible: true, available: 5, units: 2, balance: 10_000n, cost: 1_800n, acknowledged: true };

describe("market buy gating", () => {
  it("allows an eligible buyer with funds who accepted the risks", () => {
    expect(buyBlockReason(ok)).toBeNull();
  });

  it("explains the first thing to fix, in order", () => {
    expect(buyBlockReason({ ...ok, eligible: false })).toBe("你的钱包还未开通认购资格");
    expect(buyBlockReason({ ...ok, units: 6 })).toBe("可买 1–5 份");
    expect(buyBlockReason({ ...ok, balance: 1_000n })).toBe("USDT 余额不足");
    expect(buyBlockReason({ ...ok, acknowledged: false })).toBe("请先勾选确认");
  });

  it("does not block while eligibility or balance are still loading", () => {
    expect(buyBlockReason({ ...ok, eligible: undefined, balance: undefined })).toBeNull();
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
    projectId: "0xaa",
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

describe("site-wide market", () => {
  const SELLER = "0x0000000000000000000000000000000000000001" as const;
  const ME = "0x00000000000000000000000000000000000000Ee" as const;
  const l = (id: bigint, projectId: string, price: bigint, seller: `0x${string}` = SELLER): MarketListing => ({ id, projectId, seller, units: 5, fillable: 5, pricePerUnit: price, expiresAt: 0 });
  const items = [l(1n, "0xaa", 900n), l(2n, "0xbb", 850n), l(3n, "0xaa", 950n), l(4n, "0xaa", 900n), l(5n, "0xaa", 800n, ME)];

  it("sorts by price (ties newest first) or by newest", () => {
    expect(browseListings(items, { sort: "price" }).map((x) => x.id)).toEqual([5n, 2n, 4n, 1n, 3n]);
    expect(browseListings(items, { sort: "newest" }).map((x) => x.id)).toEqual([5n, 4n, 3n, 2n, 1n]);
  });

  it("filters by project, maximum price and hides my own offers", () => {
    expect(browseListings(items, { sort: "price", projectId: "0xAA", maxPrice: 900n, exclude: "0x00000000000000000000000000000000000000ee" }).map((x) => x.id)).toEqual([4n, 1n]);
  });

  it("compares a price with the subscription price", () => {
    expect(premiumPct(880n, 1000n)).toBe(-12);
    expect(premiumPct(1055n, "1000")).toBe(5.5);
    expect(premiumPct(1n, null)).toBeNull();
    expect(premiumPct(1n, 0n)).toBeNull();
  });

  it("tells the seller whether a listing can still be bought", () => {
    const base = { ...l(1n, "0xaa", 1n), expiresAt: 2_000 };
    expect(listingStatus(base, 1_000)).toBe("live");
    expect(listingStatus({ ...base, fillable: 2 }, 1_000)).toBe("short");
    expect(listingStatus(base, 2_000)).toBe("expired");
  });
});
