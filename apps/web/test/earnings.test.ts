import { describe, expect, it } from "vitest";
import { DEFAULT_TIERS } from "@roboshare/shared";
import { holderDaily, pendingTotal, sumByDay } from "@/lib/earnings";

const usdt = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const day = (d: string, net: number, status: "PENDING" | "SETTLED" = "PENDING") => ({ day: d, revenue: usdt(net), expenses: "0", net: usdt(net), rides: null, status });

describe("holderDaily", () => {
  it("takes the holder's share of issued units, less the fee tier", () => {
    // 10 of 100 units → 10%; 10+ units pay 15%.
    const [e] = holderDaily([day("2026-10-18", 1000)], 10, 100, DEFAULT_TIERS);
    expect(e).toEqual({ day: "2026-10-18", amount: BigInt(usdt(85)), pending: true });
  });

  it("is empty without units", () => {
    expect(holderDaily([day("2026-10-18", 1000)], 0, 100, DEFAULT_TIERS)).toEqual([]);
  });

  it("charges no fee when there are no tiers", () => {
    expect(holderDaily([day("2026-10-18", 100, "SETTLED")], 50, 100, [])[0]).toEqual({ day: "2026-10-18", amount: BigInt(usdt(50)), pending: false });
  });
});

describe("sumByDay", () => {
  it("adds holdings per day, newest first, and totals the pending days", () => {
    const a = holderDaily([day("2026-10-18", 1000), day("2026-10-17", 1000, "SETTLED")], 50, 100, []);
    const b = holderDaily([day("2026-10-19", 200), day("2026-10-18", 200)], 100, 100, []);
    const sum = sumByDay([a, b]);
    expect(sum.map((d) => [d.day, d.amount])).toEqual([
      ["2026-10-19", BigInt(usdt(200))],
      ["2026-10-18", BigInt(usdt(700))],
      ["2026-10-17", BigInt(usdt(500))],
    ]);
    expect(pendingTotal(sum)).toBe(BigInt(usdt(900)));
  });
});
