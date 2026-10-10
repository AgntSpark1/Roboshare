import { defineConfig, devices } from "@playwright/test";
import { PORTS } from "./src/accounts.ts";

// Both Next apps must be built first with `pnpm --filter @roboshare/e2e build:apps` (local chain, TEST-ONLY wallets).
export default defineConfig({
  testDir: "tests",
  timeout: 180_000,
  // Hard ceiling for the whole run (setup included), so a hang fails CI instead of stalling it.
  globalTimeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./src/global-setup.ts",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "zh-CN",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    { command: "pnpm --filter @roboshare/web start", url: `http://localhost:${PORTS.web}`, reuseExistingServer: !process.env.CI, timeout: 120_000, cwd: ".." },
    { command: "pnpm --filter @roboshare/admin start", url: `http://localhost:${PORTS.admin}`, reuseExistingServer: !process.env.CI, timeout: 120_000, cwd: ".." },
  ],
});
