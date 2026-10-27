import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureReferrer, inviteLink, parseRef, storedReferrer } from "@/lib/referral";

const A = "0x00000000000000000000000000000000000000A1";
const ME = "0x00000000000000000000000000000000000000b2";

describe("invite links", () => {
  beforeEach(() => localStorage.clear());

  it("accepts only a valid address that is not the visitor", () => {
    expect(parseRef(`?ref=${A.toLowerCase()}`)).toBe(A);
    expect(parseRef("?ref=nope")).toBeNull();
    expect(parseRef("")).toBeNull();
    expect(parseRef(`?ref=${ME}`, ME.toUpperCase().replace("0X", "0x"))).toBeNull();
  });

  it("remembers the inviter from the landing URL", () => {
    captureReferrer("?utm=x");
    expect(storedReferrer()).toBeNull();
    captureReferrer(`?ref=${A}`);
    expect(storedReferrer(ME)).toBe(A);
    expect(storedReferrer(A)).toBeNull(); // never refer yourself
  });

  it("builds a checksummed link", () => {
    expect(inviteLink("https://app.roboshare.test", A.toLowerCase())).toBe(`https://app.roboshare.test/?ref=${A}`);
  });
});

const refState = vi.hoisted(() => ({ enabled: true, data: undefined as unknown, test: true, signedIn: true, settled: false }));
vi.mock("@/env", async (orig) => ({
  ...(await orig<typeof import("@/env")>()),
  get isTestChain() {
    return refState.test;
  },
}));
vi.mock("@/lib/referral", async (orig) => ({
  ...(await orig<typeof import("@/lib/referral")>()),
  useReferralTerms: () => ({ data: { enabled: refState.enabled, shareBps: 2_000, windowSeconds: 365 * 86_400 } }),
  useShowReferrals: (test: boolean) => test || refState.enabled,
  useMyReferrals: () => ({ data: refState.data }),
}));
vi.mock("@/lib/data", () => ({
  useRefreshAfterTx: () => () => undefined,
  useProjects: () => ({ data: { items: [{ offering: { status: refState.settled ? "SETTLED" : "OPEN" } }] } }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/referral" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@roboshare/ui", async (orig) => ({
  ...(await orig<typeof import("@roboshare/ui")>()),
  useTxRunner: () => ({ run: { states: [], running: false }, start: vi.fn() }),
  useAccount: () => ({ address: refState.signedIn ? ME : undefined, isConnected: refState.signedIn }),
  useSession: () => ({ me: refState.signedIn ? { wallet: ME.toLowerCase() } : null, loading: false }),
  WalletButton: () => <button type="button">连接钱包</button>,
}));

const { ReferralCenter } = await import("@/components/ReferralCenter");
const { Tabs } = await import("@/components/Header");
const ONE = 10n ** 18n;
const mine = {
  wallet: ME,
  contract: "0x00000000000000000000000000000000000004eF",
  referredBy: null,
  referees: [
    { wallet: A, shareBps: 1_000, boundAt: "2026-10-01T00:00:00.000Z", expiresAt: "2027-10-01T00:00:00.000Z", active: true, earned: (16n * ONE).toString() },
    { wallet: "0x00000000000000000000000000000000000000C3", shareBps: 1_000, boundAt: null, expiresAt: "2026-01-01T00:00:00.000Z", active: false, earned: "0" },
  ],
  levelBps: [1_000, 500, 300],
  level2: [
    { wallet: "0x00000000000000000000000000000000000000D4", via: A, shareBps: 500, boundAt: "2026-10-05T00:00:00.000Z", expiresAt: "2027-10-05T00:00:00.000Z", active: true, earned: (5n * ONE).toString() },
  ],
  level3: [
    { wallet: "0x00000000000000000000000000000000000000E5", via: "0x00000000000000000000000000000000000000D4", shareBps: 300, boundAt: "2026-10-06T00:00:00.000Z", expiresAt: "2027-10-06T00:00:00.000Z", active: true, earned: (3n * ONE).toString() },
  ],
  history: [
    { projectId: `0x${"ab".repeat(32)}`, projectTitle: "星港 01 号", batchId: 3, referee: A, level: 1, gross: (160n * ONE).toString(), fee: (48n * ONE).toString(), shareBps: 1_000, reward: (16n * ONE).toString() },
    { projectId: `0x${"ab".repeat(32)}`, projectTitle: "星港 01 号", batchId: 3, referee: "0x00000000000000000000000000000000000000D4", level: 2, gross: (100n * ONE).toString(), fee: (30n * ONE).toString(), shareBps: 500, reward: (5n * ONE).toString() },
    { projectId: `0x${"ab".repeat(32)}`, projectTitle: "星港 01 号", batchId: 3, referee: "0x00000000000000000000000000000000000000E5", level: 3, gross: (100n * ONE).toString(), fee: (30n * ONE).toString(), shareBps: 300, reward: (3n * ONE).toString() },
  ],
  earned: (16n * ONE).toString(),
  claimed: "0",
  pendingPublication: "0",
  claimable: { cumulative: (16n * ONE).toString(), amount: (16n * ONE).toString(), proof: [], epoch: 1 },
};

describe("referral centre", () => {
  it("is closed on mainnet while the programme is off", () => {
    Object.assign(refState, { test: false, enabled: false, data: mine, signedIn: true });
    render(<ReferralCenter />);
    expect(screen.getByTestId("referral-off")).toHaveTextContent("推广功能暂未开放");
    expect(screen.queryByTestId("invite-link")).not.toBeInTheDocument();
  });

  it("previews the link and QR code on testnet before the programme is on", () => {
    Object.assign(refState, { test: true, enabled: false, data: undefined, signedIn: true });
    render(<ReferralCenter />);
    expect(screen.getByTestId("referral-off")).toHaveTextContent(/测试网预览/);
    expect(screen.getByTestId("invite-link").textContent).toContain(`?ref=${ME}`);
    expect(screen.getByRole("img", { name: "推广二维码" })).toBeInTheDocument();
    expect(screen.getByText("还没有成员，把链接或二维码分享给好友吧。")).toBeInTheDocument();
  });

  it("asks visitors to sign in first", () => {
    Object.assign(refState, { test: true, enabled: true, data: undefined, signedIn: false });
    render(<ReferralCenter />);
    expect(screen.getByText(/签名登录后，可以生成你的推广链接/)).toBeInTheDocument();
    expect(screen.queryByTestId("invite-link")).not.toBeInTheDocument();
  });

  it("lists all three levels, earnings detail and the claim", () => {
    Object.assign(refState, { test: false, enabled: true, data: mine, signedIn: true });
    render(<ReferralCenter />);
    expect(screen.queryByTestId("referral-off")).not.toBeInTheDocument();
    expect(screen.getByTestId("members-summary")).toHaveTextContent("共 2 人，1 人在奖励期内");
    expect(screen.getByText(/星港 01 号 第 3 期 · 好友分润 160.00 · 你得 16.00 USDT/)).toBeInTheDocument();
    expect(screen.getByText(/加入时间待同步/)).toBeInTheDocument();
    expect(screen.getByTestId("level2-summary")).toHaveTextContent("共 1 人，1 人在奖励期内");
    expect(screen.getAllByText(/由 0x.*邀请/)).toHaveLength(2);
    expect(screen.getByText(/星港 01 号 第 3 期 · 好友分润 100.00 · 你得 5.00 USDT/)).toBeInTheDocument();
    expect(screen.getByTestId("level3-summary")).toHaveTextContent("共 1 人，1 人在奖励期内");
    expect(screen.getByText(/星港 01 号 第 3 期 · 好友分润 100.00 · 你得 3.00 USDT/)).toBeInTheDocument();
    expect(screen.getByText(/最多三层/)).toBeInTheDocument();
    expect(screen.getByText(/直推好友拿他分润的 10%，好友邀请的人拿 5%，再下一层拿 3%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "领取 16.00 USDT" })).toBeEnabled();
  });
});

describe("bottom tabs", () => {
  it("shows the referral tab on testnet and spreads four tabs evenly", () => {
    Object.assign(refState, { test: true, enabled: false });
    render(<Tabs />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["首页", "项目", "资产", "推广"]);
    expect(screen.getByRole("link", { name: "推广" })).toHaveAttribute("aria-current", "page");
  });

  it("adds the market tab once an offering has succeeded, five tabs at most", () => {
    Object.assign(refState, { test: true, enabled: false, settled: true });
    render(<Tabs />);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["首页", "项目", "市场", "资产", "推广"]);
    expect(screen.getByRole("link", { name: "市场" })).toHaveAttribute("href", "/market");
    refState.settled = false;
  });

  it("hides it on mainnet until the programme is switched on", () => {
    Object.assign(refState, { test: false, enabled: false });
    render(<Tabs />);
    expect(screen.queryByRole("link", { name: "推广" })).not.toBeInTheDocument();
  });
});
