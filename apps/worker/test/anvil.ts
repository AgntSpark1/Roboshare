// TEST-ONLY helpers: local anvil chain with the RoboShare contracts deployed by script/Deploy.s.sol.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@roboshare/db";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  publicActions,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";

const ROOT = resolve(import.meta.dirname, "../../..");
const FOUNDRY_BIN = process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry/bin");

export interface Chain {
  proc: ChildProcess;
  rpcUrl: string;
  accounts: Address[];
  addr: Record<string, Address>;
  pub: ReturnType<typeof createPublicClient>;
  wallet: ReturnType<typeof createWalletClient>;
  test: ReturnType<typeof createTestClient>;
  stop: () => void;
}

const run = promisify(execFile);
const DEPLOY_TIMEOUT_MS = 60_000;

async function launch(port: number) {
  const proc = spawn(join(FOUNDRY_BIN, "anvil"), ["--port", String(port), "--silent"], { stdio: "ignore" });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl), cacheTime: 0 });
  for (let i = 0; ; i++) {
    try {
      await pub.getBlockNumber();
      break;
    } catch {
      if (i > 100) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const accounts = (await pub.request({ method: "eth_accounts" })) as Address[];
  return { proc, rpcUrl, pub, accounts };
}

/**
 * Runs script/Deploy.s.sol against the node. Async, so the test runner keeps its own timers, and with forge's output
 * captured, so a stalled deploy in CI says where it stopped instead of failing with an empty ETIMEDOUT.
 */
async function deploy(rpcUrl: string, accounts: Address[]) {
  const [deployer, safe, operator, reviewer, pauser, agent, feeRecipient] = accounts;
  await run(
    join(FOUNDRY_BIN, "forge"),
    ["script", "script/Deploy.s.sol", "--rpc-url", rpcUrl, "--broadcast", "--unlocked", "--sender", deployer!],
    {
      cwd: join(ROOT, "contracts"),
      env: {
        ...process.env,
        SAFE: safe, OPERATOR: operator, REVIEWER: reviewer, PAUSER: pauser,
        COMPLIANCE_AGENT: agent, FEE_RECIPIENT: feeRecipient,
        // Contracts are already compiled; online mode lets forge reach out for signature lookups, which has hung CI.
        FOUNDRY_OFFLINE: "true",
      },
      timeout: DEPLOY_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

const tail = (s: unknown) => String(s ?? "").split("\n").slice(-30).join("\n");

export async function startAnvil(port: number): Promise<Chain> {
  // The deploy takes about a second, but in CI forge has occasionally stalled for minutes on a fresh node. Retry once
  // on a fresh node and print what the stalled attempt had written.
  let node = await launch(port);
  try {
    await deploy(node.rpcUrl, node.accounts);
  } catch (e) {
    const err = e as { killed?: boolean; stdout?: string; stderr?: string; message?: string };
    console.warn(`forge script failed on the first attempt (${err.killed ? "timed out" : err.message})\n${tail(err.stdout)}\n${tail(err.stderr)}`);
    const old = node.proc;
    if (old.exitCode === null && old.signalCode === null) {
      const exited = new Promise((r) => old.once("exit", r));
      old.kill();
      await exited;
    }
    node = await launch(port);
    await deploy(node.rpcUrl, node.accounts);
  }
  const { proc, rpcUrl, pub, accounts } = node;
  const transport = http(rpcUrl);
  const broadcast = JSON.parse(
    readFileSync(join(ROOT, "contracts/broadcast/Deploy.s.sol/31337/run-latest.json"), "utf8"),
  ) as { transactions: { contractName?: string; contractAddress?: string; transactionType: string }[] };
  const addr: Record<string, Address> = {};
  for (const t of broadcast.transactions) {
    if (t.transactionType === "CREATE" && t.contractName && t.contractAddress) addr[t.contractName] = t.contractAddress as Address;
  }
  const wallet = createWalletClient({ chain: foundry, transport });
  const test = createTestClient({ chain: foundry, mode: "anvil", transport, cacheTime: 0 }).extend(publicActions);
  return { proc, rpcUrl, accounts, addr, pub, wallet, test, stop: () => proc.kill() };
}

/** Sends a transaction from an unlocked anvil account and waits for it to be mined. */
export async function send(c: Chain, from: Address, req: { address: Address; abi: any; functionName: string; args?: any[] }) {
  const hash = await c.wallet.writeContract({ account: from, chain: foundry, ...req } as any);
  const receipt = await c.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${req.functionName} reverted`);
  return receipt;
}

export async function asTimelock<T>(c: Chain, fn: (timelock: Address) => Promise<T>): Promise<T> {
  const timelock = c.addr.TimelockController!;
  await c.test.impersonateAccount({ address: timelock });
  await c.test.setBalance({ address: timelock, value: 10n ** 20n });
  try {
    return await fn(timelock);
  } finally {
    await c.test.stopImpersonatingAccount({ address: timelock });
  }
}

/** Empties every table in the test database. Refuses to run against a non-test database. */
export async function resetDb(prisma: PrismaClient) {
  const url = process.env.DATABASE_URL ?? "";
  if (!/_(test|ci)(\?|$)/.test(url)) throw new Error(`refusing to truncate non-test database ${url}`);
  const rows = await prisma.$queryRaw<{ s: string; t: string }[]>`
    SELECT table_schema AS s, table_name AS t FROM information_schema.tables
    WHERE table_schema IN ('app','chain','compliance') AND table_type = 'BASE TABLE'`;
  const list = rows.map((r) => `"${r.s}"."${r.t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}

export const bytes32 = (s: string): Hex => `0x${Buffer.from(s).toString("hex").padEnd(64, "0")}` as Hex;
