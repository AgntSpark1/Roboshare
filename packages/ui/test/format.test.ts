import { describe, expect, it } from "vitest";
import { countdown, formatBps, formatUsdt, parseUsdt, shortAddr, stateLabel, toBigInt } from "../src/format";

const ONE = 10n ** 18n;

describe("format", () => {
  it("formats USDT base units with grouping and never rounds up", () => {
    expect(formatUsdt(1_234_567n * ONE + ONE / 2n)).toBe("1,234,567.50");
    expect(formatUsdt(ONE - 1n)).toBe("0.99");
    expect(formatUsdt("0")).toBe("0.00");
    expect(formatUsdt(-5n * ONE)).toBe("-5.00");
    expect(formatUsdt(null)).toBe("0.00");
  });

  it("parses user input into base units and rejects malformed amounts", () => {
    expect(parseUsdt("1,000.5")).toBe(1000n * ONE + ONE / 2n);
    expect(parseUsdt("0")).toBe(0n);
    expect(() => parseUsdt("1.2.3")).toThrow();
    expect(() => parseUsdt("-1")).toThrow();
    expect(() => parseUsdt(`1.${"1".repeat(19)}`)).toThrow();
  });

  it("round-trips through format and parse", () => {
    for (const v of [0n, 1n * ONE, 123_456n * ONE + 78n * 10n ** 16n]) expect(parseUsdt(formatUsdt(v))).toBe(v);
  });

  it("accepts decimal strings in exponent form from the API", () => {
    expect(toBigInt("1e+21")).toBe(1000n * ONE);
    expect(toBigInt("42")).toBe(42n);
  });

  it("shortens addresses and hashes", () => {
    expect(shortAddr("0x14dC79964da2C08b23698B3D3cc7Ca32193d9955")).toBe("0x14dC…9955");
    expect(shortAddr(undefined)).toBe("—");
  });

  it("formats basis points", () => {
    expect(formatBps(2000)).toBe("20%");
    expect(formatBps(1750)).toBe("17.5%");
    expect(formatBps(1234)).toBe("12.34%");
  });

  it("counts down and stops at zero", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    expect(countdown(now + (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000, now)).toBe("2天 03:04:05");
    expect(countdown(now - 1000, now)).toBe("00:00:00");
  });

  it("labels project states in Chinese", () => {
    expect(stateLabel("OFFERING")).toBe("募集中");
    expect(stateLabel("UNKNOWN")).toBe("UNKNOWN");
  });
});
