import { describe, expect, it } from "vitest";
import { normalizeTeamCode, placeInTeams } from "../src/team.js";

describe("normalizeTeamCode", () => {
  it("upper-cases and checks the code", () => {
    expect(normalizeTeamCode(" a01 ")).toBe("A01");
    expect(normalizeTeamCode("x")).toBeNull();
    expect(normalizeTeamCode("bad-code")).toBeNull();
    expect(normalizeTeamCode("A".repeat(17))).toBeNull();
  });
});

describe("placeInTeams", () => {
  // leader a: a → b → c → d ; leader x: x → y ; z is invited by nobody in a team; d2 under c.
  const referrerOf = new Map([
    ["b", "a"],
    ["c", "b"],
    ["d", "c"],
    ["d2", "c"],
    ["y", "x"],
    ["z", "q"],
  ]);

  it("puts each wallet in the nearest leader's team with its depth", () => {
    const p = placeInTeams(referrerOf, new Set(["a", "x"]));
    expect(p.get("a")).toEqual({ leader: "a", depth: 0 });
    expect(p.get("b")).toEqual({ leader: "a", depth: 1 });
    expect(p.get("d")).toEqual({ leader: "a", depth: 3 });
    expect(p.get("d2")).toEqual({ leader: "a", depth: 3 });
    expect(p.get("y")).toEqual({ leader: "x", depth: 1 });
    expect(p.has("z")).toBe(false);
    expect(p.has("q")).toBe(false);
  });

  it("a leader inside another tree keeps its own branch", () => {
    const p = placeInTeams(referrerOf, new Set(["a", "c"]));
    expect(p.get("b")).toEqual({ leader: "a", depth: 1 });
    expect(p.get("c")).toEqual({ leader: "c", depth: 0 });
    expect(p.get("d")).toEqual({ leader: "c", depth: 1 });
  });

  it("does not loop on a cycle", () => {
    const p = placeInTeams(new Map([["m", "n"], ["n", "m"]]), new Set(["a"]));
    expect(p.size).toBe(1);
  });
});
