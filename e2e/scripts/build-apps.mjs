// Builds both Next apps for the e2e suite: local anvil chain, TEST-ONLY wallets, API on the e2e port.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appEnv } from "../src/accounts.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
for (const kind of ["web", "admin"]) {
  execFileSync("pnpm", ["--filter", `@roboshare/${kind}`, "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...appEnv(kind), NEXT_TELEMETRY_DISABLED: "1" },
  });
}
