import { describe, expect, it } from "vitest";
import { canonicalJson, financialReportSchema, reportHash } from "../src/report.js";

const base = {
  projectId: `0x${"11".repeat(32)}`,
  periodStart: "2026-07-01",
  periodEnd: "2026-10-01",
  paymentToken: `0x${"22".repeat(20)}`,
  revenue: [{ category: "RIDES", description: "fares", amount: "15000" }],
  expenses: [{ category: "CHARGING", description: "", amount: "3000" }],
  reserves: [{ kind: "MAINTENANCE", amount: "2000", rationale: "tyres" }],
  distributableAmount: "10000",
};

describe("financialReportSchema", () => {
  it("accepts a balanced report", () => {
    expect(financialReportSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a distributable amount that does not reconcile", () => {
    const r = financialReportSchema.safeParse({ ...base, distributableAmount: "10001" });
    expect(r.success).toBe(false);
  });
  it("rejects decimals and negative amounts", () => {
    expect(financialReportSchema.safeParse({ ...base, distributableAmount: "1.5" }).success).toBe(false);
    expect(financialReportSchema.safeParse({ ...base, distributableAmount: "-1" }).success).toBe(false);
  });
  it("rejects an inverted period", () => {
    expect(financialReportSchema.safeParse({ ...base, periodEnd: "2026-06-01" }).success).toBe(false);
  });
});

describe("reportHash", () => {
  it("does not depend on key order", () => {
    const a = financialReportSchema.parse(base);
    const b = financialReportSchema.parse(Object.fromEntries(Object.entries(base).reverse()));
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(reportHash(a)).toBe(reportHash(b));
  });
});
