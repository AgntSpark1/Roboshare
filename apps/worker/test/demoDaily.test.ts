import { describe, expect, it } from "vitest";
import { daysToFill, loadDemoDailyConfig, simulateDay } from "../src/demoDaily.js";

const P = `0x${"ab".repeat(32)}`;

describe("demo daily operations", () => {
  it("is off unless asked for, and never on mainnet", () => {
    expect(loadDemoDailyConfig({ CHAIN_ID: "97" })).toBeNull();
    expect(loadDemoDailyConfig({ CHAIN_ID: "97", DEMO_DAILY_OPS: "true" })?.chainId).toBe(97);
    expect(() => loadDemoDailyConfig({ CHAIN_ID: "56", DEMO_DAILY_OPS: "true" })).toThrow();
  });

  it("fills Beijing dates from the start day through yesterday", () => {
    // Started 2026-10-25 10:00 Beijing; now 2026-10-28 09:00 Beijing.
    const days = daysToFill(new Date("2026-10-25T02:00:00Z"), new Date("2026-10-28T01:00:00Z"), 8, 31);
    expect(days).toEqual(["2026-10-27", "2026-10-26", "2026-10-25"]);
    expect(daysToFill(new Date("2026-10-28T00:00:00Z"), new Date("2026-10-28T01:00:00Z"), 8, 31)).toEqual([]);
    expect(daysToFill(new Date("2026-01-01T00:00:00Z"), new Date("2026-10-28T01:00:00Z"), 8, 5)).toHaveLength(5);
  });

  it("gives repeatable figures in range", () => {
    const raised = 10_000n * 10n ** 18n;
    const a = simulateDay(P, "2026-10-27", raised);
    expect(simulateDay(P, "2026-10-27", raised)).toEqual(a);
    expect(a.revenue).toBeGreaterThanOrEqual((raised * 35n) / 10_000n);
    expect(a.revenue).toBeLessThanOrEqual((raised * 55n) / 10_000n);
    expect(a.expenses).toBeGreaterThanOrEqual((a.revenue * 35n) / 100n);
    expect(a.expenses).toBeLessThanOrEqual((a.revenue * 50n) / 100n);
    expect(a.rides).toBeGreaterThanOrEqual(18);
  });
});
