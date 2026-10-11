import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { blockReason } from "@/components/SubscribePanel";
import { I18nProvider } from "@/i18n/I18nProvider";
import { LOCALES, pickLocale } from "@/i18n/locales";
import { MESSAGES } from "@/i18n/messages";
import Risk from "../app/risk/page";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@roboshare/ui", async (orig) => ({ ...(await orig<typeof import("@roboshare/ui")>()), WalletButton: () => null }));

const { LanguageSwitch } = await import("@/components/Header");

describe("locale detection", () => {
  it("maps browser languages to the nine site languages", () => {
    expect(pickLocale("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh-CN");
    expect(pickLocale("zh-TW,zh;q=0.9")).toBe("zh-TW");
    expect(pickLocale("zh-Hant-HK")).toBe("zh-TW");
    expect(pickLocale("en-US,en;q=0.9")).toBe("en");
    expect(pickLocale("ja-JP")).toBe("ja");
    expect(pickLocale("ko-KR,ko;q=0.9")).toBe("ko");
    expect(pickLocale("vi-VN")).toBe("vi");
    expect(pickLocale("th-TH")).toBe("th");
    expect(pickLocale("in-ID")).toBe("id");
    expect(pickLocale("es-419,es;q=0.9")).toBe("es");
  });

  it("honours q-values, skips unsupported languages and falls back to Simplified Chinese", () => {
    expect(pickLocale("fr-FR,de;q=0.9,ja;q=0.5")).toBe("ja");
    expect(pickLocale("en;q=0.2,ko;q=0.8")).toBe("ko");
    expect(pickLocale("fr-FR")).toBe("zh-CN");
    expect(pickLocale(null)).toBe("zh-CN");
    expect(pickLocale("en;q=0")).toBe("zh-CN");
  });
});

describe("translations", () => {
  it("cover all nine languages with non-empty text", () => {
    expect(LOCALES).toHaveLength(9);
    const empty = (v: unknown, path: string, out: string[]) => {
      if (typeof v === "string") {
        // Only the source language has no translation note, and some languages put no word before the link.
        if (!v.trim() && !/translationNote|ackBefore|ackAfter|h1\.\d/.test(path)) out.push(path);
      } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) empty(x, `${path}.${k}`, out);
    };
    for (const { code } of LOCALES) {
      const out: string[] = [];
      empty(MESSAGES[code], code, out);
      expect(out).toEqual([]);
    }
  });

  it("translate the buy-button reasons", () => {
    const ok = { connected: true, signedIn: true, open: true, eligible: true, remaining: 40, units: 2, balance: 10n ** 30n, cost: 1n, acknowledged: true };
    expect(blockReason({ ...ok, units: 41 }, MESSAGES.en.subscribe.block)).toBe("You can buy 1–40 units");
    expect(blockReason({ ...ok, connected: false }, MESSAGES.ja.subscribe.block)).toBe("先にウォレットを接続してください");
  });

  it("keep every risk item in every language", () => {
    const n = MESSAGES["zh-CN"].risk.risks.length;
    for (const { code } of LOCALES) expect(MESSAGES[code].risk.risks).toHaveLength(n);
  });
});

describe("language switch", () => {
  it("re-renders the page in the chosen language, sets <html lang> and remembers it in a cookie", async () => {
    render(
      <I18nProvider initial="zh-CN">
        <LanguageSwitch />
        <Risk />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "投资须知" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /语言/ }));
    const dialog = screen.getByRole("dialog", { name: "语言" });
    await act(() => userEvent.click(within(dialog).getByRole("button", { name: "English" })));
    expect(screen.getByRole("heading", { level: 1, name: "Investor notes" })).toBeInTheDocument();
    expect(screen.getByText(MESSAGES.en.risk.translationNote)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(document.cookie).toContain("rs_lang=en");
  });
});
