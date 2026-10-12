// Phase 4 exit criterion: subscribe -> settle -> report -> batch -> claim, through the investor DApp and the admin
// console on a local anvil chain. Governance (the Safe), KYC and treasury funding are done by the TEST-ONLY harness.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { allocate, DEFAULT_TERM_DAYS, revenueDistributorAbi, tiersForTerm } from "@roboshare/shared";
import { erc20Abi } from "viem";
import { base32Decode, hotp } from "../../apps/api/src/common/totp.ts";
import { PORTS, ROLES } from "../src/accounts.ts";
import { ONE, projectIdOf, scenario } from "../src/scenario.ts";
import { readState } from "../src/stack.ts";

const WEB = `http://localhost:${PORTS.web}`;
const ADMIN = `http://localhost:${PORTS.admin}`;
const SLUG = "rs-e2e";
const UNIT_PRICE = 1_000n * ONE;
const UNITS = 60;

test.describe.configure({ mode: "serial" });

let s: ReturnType<typeof scenario>;
let endTime: bigint;
const ctx: Record<string, BrowserContext> = {};
const pages: Record<string, Page> = {};

/** WCAG 2.1 A/AA checks on the current page. */
async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

async function open(browser: Browser, name: string) {
  ctx[name] = await browser.newContext();
  // Third-party fonts are optional; keep the run hermetic.
  await ctx[name].route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  pages[name] = await ctx[name].newPage();
  pages[name].on("dialog", (d) => void d.accept());
  return pages[name];
}

async function staffLogin(page: Page, who: "operator" | "reviewer") {
  await page.goto(ADMIN);
  await axe(page, "admin login");
  await page.getByRole("button", { name: "连接钱包" }).click();
  await page.getByRole("button", { name: new RegExp(`测试钱包 ${ROLES[who].slice(0, 6)}`, "i") }).click();
  await page.getByRole("button", { name: "签名登录" }).click();
  const secret = readState().totp[who];
  await page.getByLabel("6 位验证码").fill(hotp(base32Decode(secret), BigInt(Math.floor(Date.now() / 30_000))));
  await page.getByRole("button", { name: "确认" }).click();
  await expect(page.getByRole("heading", { name: "待办" })).toBeVisible();
}

/**
 * Clicks a TxAction and waits until it has finished. Actions whose item leaves the list once confirmed (an approved
 * report, an approved batch, a claimed distribution) unmount their own progress, so they pass `outcome` instead.
 */
async function runTx(page: Page, button: ReturnType<Page["getByRole"]>, outcome?: () => Promise<void>) {
  await button.click();
  if (outcome) {
    await outcome();
  } else {
    await expect(page.locator("[data-state]").first()).toBeVisible();
    await expect(page.locator('[data-state]:not([data-state="done"])')).toHaveCount(0);
  }
  // Our error messages are .err[role=alert]; Next.js also renders an empty route-announcer alert.
  await expect(page.locator(".err[role=alert]")).toHaveCount(0);
}

test.beforeAll(async () => {
  s = scenario(readState());
  const o = await s.openOffering({ slug: SLUG, title: "端到端测试车辆", unitPrice: UNIT_PRICE, minUnits: 50, perWalletMax: 100, durationSec: 86_400 });
  endTime = o.endTime;
  await s.kyc(ROLES.alice);
  await s.mintUsdt(ROLES.alice, 100_000n * ONE);
  await s.indexed();
});

test.afterAll(async () => {
  for (const c of Object.values(ctx)) await c.close();
});

test("investor browses and subscribes with a one-time USDT approval", async ({ browser }) => {
  const page = await open(browser, "alice");
  await page.goto(WEB);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Robotaxi");
  await axe(page, "home");
  await page.getByRole("link", { name: "车辆项目" }).first().click();
  await expect(page.getByRole("link", { name: /端到端测试车辆/ })).toBeVisible();
  await axe(page, "projects");
  await page.getByRole("link", { name: /端到端测试车辆/ }).click();

  await page.getByRole("button", { name: "连接钱包" }).first().click();
  await page.getByRole("button", { name: new RegExp(`测试钱包 ${ROLES.alice.slice(0, 6)}`, "i") }).click();
  await page.getByRole("button", { name: /签名登录/ }).first().click();
  await expect(page.getByRole("button", { name: "授权并认购" })).toBeVisible();
  await axe(page, "project detail (signed in)");

  await page.getByLabel(/认购份数/).fill(String(UNITS));
  await expect(page.getByText("60,000.00 USDT").first()).toBeVisible();
  await page.getByRole("checkbox", { name: /投资须知/ }).check();
  await runTx(page, page.getByRole("button", { name: "授权并认购" }));
  await expect(page.getByRole("status")).toContainText("认购成功");
  await s.indexed();
  await page.reload();
  await expect(page.getByText(`已认购 ${UNITS} / 100 份`)).toBeVisible();
});

test("operator settles the offering after it ends", async ({ browser }) => {
  await s.warpPast(endTime);
  await s.indexed();
  const page = await open(browser, "operator");
  await staffLogin(page, "operator");
  await axe(page, "admin overview");
  await page.getByRole("link", { name: "募集结算" }).first().click();
  const row = page.getByTestId(`offering-${SLUG}`);
  await expect(row).toContainText("可以结算");
  await axe(page, "admin offerings");
  await runTx(page, row.getByRole("button", { name: "结算募集" }));
  await s.indexed();
  // Governance moves FUNDED -> ACTIVE once the vehicle is in service (Safe; harness).
  await s.activate(projectIdOf(SLUG));
  await s.indexed();
});

test("operator submits the period report and its hash is anchored on-chain", async () => {
  const page = pages.operator!;
  await page.getByRole("link", { name: "财务报告" }).first().click();
  await expect(page.getByRole("heading", { name: "提交财务报告" })).toBeVisible();
  await page.getByLabel("期间开始").fill("2026-09-01");
  await page.getByLabel("期间结束").fill("2026-09-30");
  await page.getByRole("group", { name: "收入" }).getByLabel("金额（USDT）").fill("10000");
  await page.getByRole("group", { name: "支出" }).getByLabel("金额（USDT）").fill("1000");
  await page.getByLabel("储备金额（USDT）").fill("0");
  await expect(page.getByTestId("distributable")).toHaveText("9,000.00 USDT");
  await axe(page, "admin reports");
  await runTx(page, page.getByRole("button", { name: "提交并把报告哈希上链" }));
  await s.indexed();
  await page.reload();
  await expect(page.getByText("哈希已上链").first()).toBeVisible();
});

test("a different reviewer approves the report", async ({ browser }) => {
  const page = await open(browser, "reviewer");
  await staffLogin(page, "reviewer");
  await expect(page.getByText(/端到端测试车辆 财务报告/)).toBeVisible();
  await page.getByRole("link", { name: "财务报告" }).first().click();
  await runTx(page, page.getByRole("button", { name: "批准", exact: true }).first(), async () => {
    await expect(page.locator(".pill", { hasText: "已批准" }).first()).toBeVisible();
  });
  await s.indexed();
  await page.reload();
  await expect(page.locator(".pill", { hasText: "已批准" }).first()).toBeVisible();
});

test("operator proposes the distribution batch and the reviewer approves it", async () => {
  const pid = projectIdOf(SLUG);
  await s.fundTreasury(await s.distributorOf(pid), 9_000n * ONE);
  await s.indexed();

  const op = pages.operator!;
  await op.getByRole("link", { name: "分配批次" }).first().click();
  await op.getByRole("button", { name: "预览分配" }).click();
  await expect(op.getByRole("table", { name: "分配预览" })).toContainText("60");
  await axe(op, "admin distributions");
  // The preview (and its tx progress) closes once the batch is proposed; a status line replaces it.
  await op.getByRole("button", { name: /提议批次/ }).click();
  await expect(op.getByRole("status").filter({ hasText: "批次已提议上链" })).toBeVisible();
  await expect(op.locator(".err[role=alert]")).toHaveCount(0);

  const rv = pages.reviewer!;
  await rv.getByRole("link", { name: "分配批次" }).first().click();
  const batch = rv.getByTestId(`batch-${pid}`);
  await expect(batch).toContainText("已备足并授权");
  const distributor = await s.distributorOf(pid);
  await runTx(rv, batch.getByRole("button", { name: "批准并开放领取" }), async () => {
    await expect.poll(() => s.pub.readContract({ address: distributor, abi: revenueDistributorAbi, functionName: "pendingBatchId" }), { timeout: 30_000 }).toBe(0n);
  });
  await s.indexed();
});

test("investor claims the distribution in USDT", async () => {
  const page = pages.alice!;
  const usdt = readState().addr.MockUSDT!;
  const before = await s.pub.readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [ROLES.alice] });
  await page.getByRole("link", { name: "我的资产" }).first().click();
  // Sole holder of 60 units: gross 9,000; default 720-day term, tier 50+ = 7.5% operator share, net 8,325.
  const expected = allocate(9_000n * ONE, 0n, [{ address: ROLES.alice, units: UNITS }], tiersForTerm(DEFAULT_TERM_DAYS)).allocations[0]!.net;
  expect(expected).toBe(8_325n * ONE);
  await expect(page.getByTestId("claimable-total")).toHaveText("8,325.00");
  await axe(page, "portfolio");
  const balance = () => s.pub.readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [ROLES.alice] });
  await runTx(page, page.getByRole("button", { name: /领取 8,325.00 USDT/ }), async () => {
    await expect.poll(async () => (await balance()) - before, { timeout: 30_000 }).toBe(expected);
  });
  await s.indexed();
  await page.reload();
  await expect(page.getByTestId("claimable-total")).toHaveText("0.00");
});

test("investor lists units for early exit and another investor buys them", async ({ browser }) => {
  const pid = projectIdOf(SLUG);
  await s.kyc(ROLES.bob);
  await s.mintUsdt(ROLES.bob, 10_000n * ONE);
  await s.indexed();

  // Seller: from the portfolio's 转让 link straight into the market's sell form.
  const seller = pages.alice!;
  await seller.getByRole("link", { name: "转让" }).first().click();
  await expect(seller.getByRole("heading", { name: "转让市场" })).toBeVisible();
  const sell = seller.getByRole("dialog", { name: "我要卖" });
  await sell.getByLabel("出售份数").fill("10");
  await sell.getByLabel("每份价格（USDT）").fill("900");
  await expect(sell.getByText("全部卖出可得 9,000.00 USDT")).toBeVisible();
  await runTx(seller, sell.getByRole("button", { name: "挂单出售" }));
  await expect(sell.getByRole("status").filter({ hasText: "挂单成功" })).toBeVisible();
  await sell.getByRole("button", { name: "关闭" }).click();

  // The seller manages the listing: lower the price.
  await seller.getByRole("tab", { name: /我的挂单/ }).click();
  const mine = seller.locator('[data-testid^="my-listing-"]');
  await expect(mine).toContainText("10 份");
  await expect(mine).toContainText("在售");
  await mine.getByRole("button", { name: "改价" }).click();
  await seller.getByLabel("每份价格（USDT）").fill("880");
  await runTx(seller, seller.getByRole("button", { name: "保存修改" }));
  await expect(seller.getByRole("status").filter({ hasText: "挂单已更新" })).toBeVisible();
  await expect(mine).toContainText("880.00");
  await axe(seller, "market (seller)");

  // Buyer: a second investor finds the offer on the site-wide market and buys 4.
  const buyer = await open(browser, "bob");
  await buyer.goto(`${WEB}/market`);
  const card = buyer.locator('[data-testid^="market-listing-"]').first();
  await expect(card).toContainText("880.00");
  await expect(card).toContainText("10 份");
  await buyer.getByRole("button", { name: "连接钱包" }).first().click();
  await buyer.getByRole("button", { name: new RegExp(`测试钱包 ${ROLES.bob.slice(0, 6)}`, "i") }).click();
  await buyer.getByRole("button", { name: /签名登录/ }).first().click();
  await card.getByRole("button", { name: "买入", exact: true }).click();
  const buy = buyer.getByRole("dialog");
  await buy.getByLabel("购买份数").fill("4");
  await expect(buy.getByText("3,520.00 USDT").first()).toBeVisible();
  await buy.getByRole("checkbox", { name: /投资须知/ }).check();
  await axe(buyer, "market (buy)");
  await runTx(buyer, buy.getByRole("button", { name: "授权并购买" }));
  await expect(buy.getByRole("status").filter({ hasText: "购买成功" })).toBeVisible();
  await buy.getByRole("button", { name: "关闭" }).click();

  // The trade shows in the history and sets the project's reference price.
  await s.indexed();
  await buyer.reload();
  await buyer.getByRole("tab", { name: "成交记录" }).click();
  await expect(buyer.getByRole("row").filter({ hasText: "3,520.00" })).toBeVisible();
  await buyer.goto(`${WEB}/projects/${pid}`);
  await expect(buyer.locator("#market").getByText("最近成交 880.00 USDT/份").first()).toBeVisible();

  const token = await s.tokenOf(pid);
  const units = (who: `0x${string}`) => s.pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  expect(await units(ROLES.bob)).toBe(4n);
  expect(await units(ROLES.alice)).toBe(BigInt(UNITS - 4));
});
