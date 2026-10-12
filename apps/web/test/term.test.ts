import { describe, expect, it } from "vitest";
import { termLine } from "@/lib/term";
import { zhCN } from "@/i18n/messages/zh-CN";
import { en } from "@/i18n/messages/en";

const s = zhCN.projects.term;

describe("termLine", () => {
  it("is null without a term", () => {
    expect(termLine(null, s)).toBeNull();
    expect(termLine(undefined, s)).toBeNull();
  });

  it("leaves out the remaining days before operations start", () => {
    expect(termLine({ termDays: 720, startedAt: null, endsAt: null, remainingDays: null }, s)).toBe("运营期 720 天 · 每月分配 · 到期卖车款按份额返还");
  });

  it("shows the remaining days once running, down to zero", () => {
    const started = { termDays: 360, startedAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-12-27T00:00:00.000Z" };
    expect(termLine({ ...started, remainingDays: 76 }, s)).toBe("运营期 360 天 · 剩余 76 天 · 每月分配 · 到期卖车款按份额返还");
    expect(termLine({ ...started, remainingDays: 0 }, en.projects.term)).toBe("360-day term · 0 days left · Paid monthly · Car sale proceeds returned pro rata at term end");
  });
});
