import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AaveDeployment, AllowlistedReserve } from "@roboshare/shared";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AaveConfigError, readAaveMarkets } from "../src/aave.js";

// TEST-ONLY: exercises the reader against mock Aave contracts on a local anvil chain (chain 31337).
// The real BSC addresses are checked by contracts/test/fork/AaveBnb.fork.t.sol when an RPC is available.
const ROOT = resolve(import.meta.dirname, "../../..");
const artifact = (file: string, name: string) =>
  JSON.parse(readFileSync(join(ROOT, "contracts/out", file, `${name}.json`), "utf8")) as { abi: any; bytecode: { object: Hex } };

let proc: ChildProcess;
const transport = http("http://127.0.0.1:18547");
const pub = createPublicClient({ chain: foundry, transport, cacheTime: 0 });
const wallet = createWalletClient({ chain: foundry, transport });
let me: Address;
let dep: AaveDeployment;
let provider: Address;
const USDT = "0x55d398326f99059fF775485246999027B3197955" as Address;
const allow: AllowlistedReserve[] = [{ symbol: "USDT", underlying: USDT, decimals: 18 }];

async function deploy(name: string, args: unknown[] = []): Promise<Address> {
  const a = artifact("MockAave.sol", name);
  const hash = await wallet.deployContract({ account: me, abi: a.abi, bytecode: a.bytecode.object, args });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
}

async function call(address: Address, name: string, functionName: string, args: unknown[]) {
  const hash = await wallet.writeContract({ account: me, chain: foundry, address, abi: artifact("MockAave.sol", name).abi, functionName, args });
  await pub.waitForTransactionReceipt({ hash });
}

beforeAll(async () => {
  proc = spawn(join(process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry/bin"), "anvil"), ["--port", "18547", "--silent"], { stdio: "ignore" });
  for (let i = 0; ; i++) {
    try { await pub.getBlockNumber(); break; } catch { if (i > 100) throw new Error("anvil did not start"); await new Promise((r) => setTimeout(r, 100)); }
  }
  [me] = (await pub.request({ method: "eth_accounts" })) as Address[];
  const pool = await deploy("MockAavePool");
  const oracle = await deploy("MockAaveOracle");
  const data = await deploy("MockPoolDataProvider");
  provider = await deploy("MockPoolAddressesProvider", [pool, oracle, data]);
  await call(data, "MockPoolDataProvider", "addReserve", ["USDT", USDT, 18n]);
  await call(oracle, "MockAaveOracle", "setPrice", [USDT, 100_000_000n]);
  dep = { chainId: 31337, poolAddressesProvider: provider, pool, oracle, dataProvider: data, source: "TEST-ONLY mocks" };
}, 60_000);

afterAll(() => proc?.kill());

describe("readAaveMarkets", () => {
  it("returns verified reserve data pinned to a block", async () => {
    const s = await readAaveMarkets(pub as any, dep, allow);
    expect(s.blockNumber).toBeGreaterThan(0n);
    expect(s.reserves).toHaveLength(1);
    expect(s.reserves[0]).toMatchObject({
      symbol: "USDT",
      supplyAprBps: 500,
      variableBorrowAprBps: 800,
      ltvBps: 7500,
      priceInBaseCurrency: "100000000",
      baseCurrencyUnit: "100000000",
      totalSupplied: (1_000_000n * 10n ** 18n).toString(),
    });
  });

  it("refuses the wrong chain", async () => {
    await expect(readAaveMarkets(pub as any, { ...dep, chainId: 56 }, allow)).rejects.toBeInstanceOf(AaveConfigError);
  });

  it("refuses an address with no code", async () => {
    await expect(readAaveMarkets(pub as any, { ...dep, oracle: "0x000000000000000000000000000000000000dEaD" }, allow)).rejects.toThrow(/no code/);
  });

  it("refuses when the provider points at a different pool", async () => {
    const other = await deploy("MockAavePool");
    await call(provider, "MockPoolAddressesProvider", "setPool", [other]);
    await expect(readAaveMarkets(pub as any, dep, allow)).rejects.toThrow(/reports pool/);
    await call(provider, "MockPoolAddressesProvider", "setPool", [dep.pool]);
  });

  it("refuses an allowlisted asset that is not a reserve, or whose decimals differ", async () => {
    const fake = "0x1111111111111111111111111111111111111111" as Address;
    await expect(readAaveMarkets(pub as any, dep, [{ symbol: "FAKE", underlying: fake, decimals: 18 }])).rejects.toThrow(/not a reserve/);
    await expect(readAaveMarkets(pub as any, dep, [{ symbol: "USDT", underlying: USDT, decimals: 6 }])).rejects.toThrow(/decimals/);
  });
});
