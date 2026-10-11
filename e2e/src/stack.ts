// TEST-ONLY: a complete local RoboShare stack for the browser e2e suite and for local demos.
// anvil (with script/Deploy.s.sol) + Postgres migrations + API + indexer worker. The Next apps are started by
// Playwright's webServer (see playwright.config.ts) from builds made with scripts/build-apps.mjs.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@roboshare/db";
import { createPublicClient, createTestClient, createWalletClient, http, publicActions, type Address } from "viem";
import { foundry } from "viem/chains";
import { PORTS, ROLES } from "./accounts.ts";
// The API's own helpers, so enrolled secrets are encrypted exactly as the API expects.
import { encryptSecret, newTotpSecret } from "../../apps/api/src/common/totp.ts";

export const ROOT = resolve(import.meta.dirname, "../..");
const FOUNDRY_BIN = process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry/bin");
export const STATE_FILE = join(ROOT, "e2e/.stack.json");

export interface StackState {
  rpcUrl: string;
  addr: Record<string, Address>;
  totp: { operator: string; reviewer: string };
  databaseUrl: string;
}

export function clients(rpcUrl: string) {
  const transport = http(rpcUrl);
  return {
    pub: createPublicClient({ chain: foundry, transport, cacheTime: 0 }),
    wallet: createWalletClient({ chain: foundry, transport }),
    test: createTestClient({ chain: foundry, mode: "anvil", transport, cacheTime: 0 }).extend(publicActions),
  };
}

function databaseUrl() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://roboshare:roboshare@localhost:5432/roboshare_e2e_test";
  if (!/_(test|ci)(\?|$)/.test(url)) throw new Error(`refusing to use non-test database ${url}`);
  return url;
}

async function waitFor(what: string, fn: () => Promise<unknown>, ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      // not up yet
    }
    if (Date.now() > until) throw new Error(`${what} did not become ready`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const execAsync = promisify(execFile);

/** Progress lines, so a stuck CI run shows which step it is on. */
function step(msg: string) {
  process.stdout.write(`[e2e stack] ${msg}\n`);
}

/**
 * Runs a command without blocking the event loop (a blocked loop stops draining the child pipes, which can stall
 * anvil and the web servers), with a hard timeout so a hang fails the run instead of stalling CI.
 */
async function exec(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) {
  try {
    await execAsync(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, timeout: opts.timeoutMs ?? 180_000, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; killed?: boolean; message: string };
    throw new Error(`${cmd} ${args.join(" ")} failed${x.killed ? " (timed out)" : ""}: ${x.message}\n${x.stdout ?? ""}\n${x.stderr ?? ""}`);
  }
}

function start(name: string, cmd: string, args: string[], env: Record<string, string>): ChildProcess {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.on("error", (e) => process.stderr.write(`[${name}] failed to start: ${e.message}\n`));
  p.on("exit", (code, sig) => code && process.stderr.write(`[${name}] exited with ${code ?? sig}\n`));
  const log = (b: Buffer) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${b}`);
  p.stdout?.on("data", log);
  p.stderr?.on("data", (b: Buffer) => process.stderr.write(`[${name}] ${b}`));
  return p;
}

export async function startStack(): Promise<{ state: StackState; stop: () => Promise<void> }> {
  const procs: ChildProcess[] = [];
  const stop = async () => {
    for (const p of procs.reverse()) p.kill("SIGTERM");
  };
  try {
    // 1. chain + contracts
    const rpcUrl = `http://127.0.0.1:${PORTS.anvil}`;
    const { pub } = clients(rpcUrl);
    step("starting anvil");
    const launchAnvil = async () => {
      const p = start("anvil", join(FOUNDRY_BIN, "anvil"), ["--port", String(PORTS.anvil), "--silent"], {});
      procs.push(p);
      await waitFor("anvil", () => pub.getBlockNumber().then(() => true));
      return p;
    };
    // --slow sends one transaction at a time: forge 1.5.1's batched broadcast hangs against anvil in roughly one run in
    // fifteen.
    const deploy = () =>
      exec(join(FOUNDRY_BIN, "forge"), ["script", "script/Deploy.s.sol", "--rpc-url", rpcUrl, "--broadcast", "--unlocked", "--sender", ROLES.deployer, "--slow"], {
        cwd: join(ROOT, "contracts"),
        timeoutMs: 90_000,
        env: {
          ...process.env,
          SAFE: ROLES.safe,
          OPERATOR: ROLES.operator,
          REVIEWER: ROLES.reviewer,
          PAUSER: ROLES.pauser,
          COMPLIANCE_AGENT: ROLES.agent,
          FEE_RECIPIENT: ROLES.feeRecipient,
          // Contracts are already compiled; don't let the script reach out for signature lookups or verification.
          FOUNDRY_OFFLINE: "true",
        },
      });
    let anvil = await launchAnvil();
    step("deploying contracts (forge script)");
    try {
      await deploy();
    } catch (e) {
      // In CI the deploy occasionally stalls with no output while a fresh run succeeds in seconds: retry once on a new
      // chain, printing the stalled attempt's output.
      process.stderr.write(`[e2e stack] deploy failed, retrying on a fresh anvil:\n${(e as Error).message.split("\n").slice(-30).join("\n")}\n`);
      const exited = new Promise((r) => anvil.once("exit", r));
      anvil.kill("SIGKILL");
      if (anvil.exitCode === null && anvil.signalCode === null) await exited;
      procs.splice(procs.indexOf(anvil), 1);
      anvil = await launchAnvil();
      step("deploying contracts again (forge script)");
      await deploy();
    }
    const run = JSON.parse(readFileSync(join(ROOT, "contracts/broadcast/Deploy.s.sol/31337/run-latest.json"), "utf8")) as {
      transactions: { contractName?: string; contractAddress?: string; transactionType: string }[];
    };
    const addr: Record<string, Address> = {};
    for (const t of run.transactions) if (t.transactionType === "CREATE" && t.contractName && t.contractAddress) addr[t.contractName] = t.contractAddress as Address;

    // 2. database: migrate, empty it, enrol two staff wallets with authenticators
    const dbUrl = databaseUrl();
    step("migrating the test database");
    await exec("pnpm", ["--filter", "@roboshare/db", "migrate"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: dbUrl } });
    const prisma = new PrismaClient({ datasourceUrl: dbUrl });
    const rows = await prisma.$queryRaw<{ s: string; t: string }[]>`
      SELECT table_schema AS s, table_name AS t FROM information_schema.tables
      WHERE table_schema IN ('app','chain','compliance') AND table_type = 'BASE TABLE'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.s}"."${r.t}"`).join(", ")} CASCADE`);
    const totpKey = randomBytes(32).toString("hex");
    const totp = { operator: newTotpSecret(), reviewer: newTotpSecret() };
    for (const [who, roles] of [["operator", ["OPERATOR"]], ["reviewer", ["REVIEWER", "GOV_VIEW"]]] as const) {
      await prisma.user.create({
        data: {
          wallets: { create: { address: ROLES[who].toLowerCase() } },
          staff: { create: { roles: [...roles], totpSecretEnc: encryptSecret(totp[who], totpKey) } },
        },
      });
    }
    await prisma.$disconnect();

    // 3. API + indexer
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    step("starting the API and the indexer");
    const common = { DATABASE_URL: dbUrl, REDIS_URL: redisUrl, CHAIN_ID: "31337" };
    procs.push(
      start("api", "node", ["apps/api/dist/main.js"], {
        ...common,
        NODE_ENV: "development",
        PORT: String(PORTS.api),
        SESSION_SECRET: randomBytes(32).toString("hex"),
        SIWE_DOMAIN: `localhost:${PORTS.web},localhost:${PORTS.admin},127.0.0.1:${PORTS.web},127.0.0.1:${PORTS.admin}`,
        TOTP_ENC_KEY: totpKey,
        RATE_LIMIT_PER_MINUTE: "100000",
        ASSET_REGISTRY: addr.AssetRegistry!,
        AUDIT_REGISTRY: addr.AuditRegistry!,
        PAYMENT_TOKEN: addr.MockUSDT!,
        TIMELOCK: addr.TimelockController!,
      }),
    );
    procs.push(
      start("worker", "node", ["apps/worker/dist/main.js"], {
        ...common,
        RPC_URL: rpcUrl,
        ASSET_REGISTRY: addr.AssetRegistry!,
        AUDIT_REGISTRY: addr.AuditRegistry!,
        IDENTITY_REGISTRY: addr.IdentityRegistry!,
        SUBSCRIPTION_ROUTER: addr.SubscriptionRouter!,
        PROJECT_FACTORY: addr.ProjectFactory!,
        REFERRAL_REWARDS: addr.ReferralRewards!,
        SHARE_MARKET: addr.ShareMarket!,
        START_BLOCK: "0",
        CONFIRMATIONS: "0",
        INDEXER_POLL_MS: "400",
        RECONCILE_EVERY_TICKS: "20",
        AAVE_RPC_URL: "",
      }),
    );
    const api = `http://127.0.0.1:${PORTS.api}/api/v1`;
    await waitFor("api + indexer", async () => {
      const h = (await (await fetch(`${api}/health`)).json()) as { indexer: { lastBlock: string } | null };
      return h.indexer && BigInt(h.indexer.lastBlock) >= (await pub.getBlockNumber());
    });
    const state: StackState = { rpcUrl, addr, totp, databaseUrl: dbUrl };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    step("ready");
    return { state, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}

export function readState(): StackState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as StackState;
}
