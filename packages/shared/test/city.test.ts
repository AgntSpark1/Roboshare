import { describe, expect, it } from "vitest";
import { CITY_REWARD_CAP, cityReward, planCityRewards, type CityMint } from "../src/city.js";

const ONE = 10n ** 18n;
const PRICE = 100n * ONE;
const day = (d: number) => new Date(Date.UTC(2026, 10, d));
const NOW = day(45);
const mint = (id: string, wallet: string, units: number, d: number, projectId = "1", unitPrice = PRICE): CityMint => ({ id, projectId, wallet, units, unitPrice, mintedAt: day(d) });
const leaders: Record<string, string> = { a: "L", b: "L", c: "M", L: "L" };
const base = { now: NOW, leaderOf: (w: string) => leaders[w], frozen: () => false, paid: 0n };

describe("city reward", () => {
  it("pays 1 USDT per 100 USDT of units", () => {
    expect(cityReward(1, PRICE)).toBe(ONE);
    expect(cityReward(3, 500n * ONE)).toBe(15n * ONE);
  });

  it("counts mints held a full month by members, not by the leader or wallets without a team", () => {
    const held = new Map([["1:a", 10], ["1:b", 5], ["1:L", 50], ["1:x", 9]]);
    const rows = planCityRewards([mint("m1", "a", 10, 1), mint("m2", "b", 5, 20), mint("m3", "L", 50, 1), mint("m4", "x", 9, 1)], { ...base, held });
    expect(rows.map((r) => [r.mintId, r.leader, r.units, r.reward])).toEqual([["m1", "L", 10, 10n * ONE]]);
  });

  it("pays only for units still held, oldest mint first", () => {
    const rows = planCityRewards([mint("m1", "a", 10, 1), mint("m2", "a", 10, 2)], { ...base, held: new Map([["1:a", 12]]) });
    expect(rows.map((r) => [r.mintId, r.units, r.reward])).toEqual([["m1", 10, 10n * ONE], ["m2", 2, 2n * ONE]]);
  });

  it("skips a frozen leader and stops at the programme total", () => {
    const held = new Map([["1:a", 100], ["1:c", 100]]);
    expect(planCityRewards([mint("m1", "a", 100, 1)], { ...base, held, frozen: (w) => w === "L" })).toEqual([]);
    const rows = planCityRewards([mint("m1", "a", 100, 1), mint("m2", "c", 100, 1)], { ...base, held, paid: CITY_REWARD_CAP - 150n * ONE });
    expect(rows.map((r) => r.reward)).toEqual([100n * ONE, 50n * ONE]);
  });
});
