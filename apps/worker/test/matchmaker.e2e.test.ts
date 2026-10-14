import { PrismaClient } from "@roboshare/db";
import { assetRegistryAbi, offeringManagerAbi, projectFactoryAbi, subscriptionRouterAbi } from "@roboshare/shared";
import { erc20Abi, keccak256, parseAbi, stringToHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVATE_REASON, Matchmaker, projectIdForSlug } from "../src/matchmaker.js";
import { Indexer } from "../src/indexer.js";
import { asSafe, bytes32, resetDb, send, startAnvil, type Chain } from "./anvil.js";

const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const ONE = 10n ** 18n;
const UNIT_PRICE = 100n * ONE;
const OPERATOR_ROLE = keccak256(stringToHex("OPERATOR_ROLE"));
const REVIEWER_ROLE = keccak256(stringToHex("REVIEWER_ROLE"));
const LAUNCHER_ROLE = keccak256(stringToHex("LAUNCHER_ROLE"));
const CHAIN = 31337;

describe("robot matchmaking on a local chain", () => {
  let c: Chain;
  let prisma: PrismaClient;
  let indexer: Indexer;
  let mm: Matchmaker;
  let usdt: Address;
  let treasury: Address;
  let now = new Date();
  const launcherKey = generatePrivateKey();
  const verifierKey = generatePrivateKey();
  const backstopKey = generatePrivateKey();
  const launcher = privateKeyToAccount(launcherKey).address;
  const verifier = privateKeyToAccount(verifierKey).address;
  const backstop = privateKeyToAccount(backstopKey).address;

  const chainNow = async () => new Date(Number((await c.pub.getBlock()).timestamp) * 1000);

  /** Indexer and matchmaker passes until nothing more happens. */
  async function run(passes = 10) {
    const kinds: string[] = [];
    for (let i = 0; i < passes; i++) {
      await indexer.catchUp();
      now = await chainNow();
      const ev = await mm.tick();
      kinds.push(...ev.map((e) => e.kind));
    }
    await indexer.catchUp();
    return kinds;
  }

  const offeringOf = async (pid: Hex) =>
    (await c.pub.readContract({ address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "offeringOf", args: [pid] })) as Address;

  beforeAll(async () => {
    c = await startAnvil(18548);
    prisma = new PrismaClient();
    await resetDb(prisma);
    usdt = c.addr.MockUSDT!;
    treasury = c.accounts[9]!;
    indexer = new Indexer(prisma, c.pub as any, {
      chainId: CHAIN, rpcUrl: c.rpcUrl, assetRegistry: c.addr.AssetRegistry!, auditRegistry: c.addr.AuditRegistry!,
      identityRegistry: c.addr.IdentityRegistry!, subscriptionRouter: c.addr.SubscriptionRouter!, projectFactory: c.addr.ProjectFactory!,
      startBlock: 0n, confirmations: 0, batchSize: 50,
    });
    await indexer.init();

    // Governance grants the matchmaker wallets their roles and sets the launch template.
    await asSafe(c, async (safe) => {
      await send(c, safe, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "grantRole", args: [OPERATOR_ROLE, launcher] });
      await send(c, safe, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "grantRole", args: [REVIEWER_ROLE, verifier] });
      await send(c, safe, { address: c.addr.ProjectFactory!, abi: projectFactoryAbi, functionName: "grantRole", args: [LAUNCHER_ROLE, launcher] });
      await send(c, safe, {
        address: c.addr.ProjectFactory!, abi: projectFactoryAbi, functionName: "setLaunchTemplate",
        args: [{ enabled: true, unitPrice: UNIT_PRICE, minUnits: 10, perWalletMax: 100, durationDays: 3, termDays: 720, minLaunchInterval: 60, treasury, termsHash: bytes32("terms") }],
      });
    });
    for (const a of [launcher, verifier, backstop]) await c.test.setBalance({ address: a, value: 10n * ONE });

    mm = new Matchmaker(prisma, c.pub as any, {
      chainId: CHAIN, rpcUrl: c.rpcUrl, assetRegistry: c.addr.AssetRegistry!, projectFactory: c.addr.ProjectFactory!,
      subscriptionRouter: c.addr.SubscriptionRouter!, paymentToken: usdt, safe: c.accounts[1]!,
      launcherKey, verifierKey, backstopKey, issuerId: bytes32("issuer"), rightsDocHash: bytes32("rights"),
    }, () => now);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    c?.stop();
  });

  it("publishes its wallets and does nothing until switched on", async () => {
    const s = await mm.init();
    expect(s.backstopAddress).toBe(backstop.toLowerCase());
    expect(s.launchEnabled).toBe(false);
    expect(await run(2)).toEqual([]);
  });

  it("lists a demo vehicle on the template's terms", async () => {
    await prisma.matchmakerSettings.update({ where: { chainId: CHAIN }, data: { launchEnabled: true, launchMode: "AUTO", demoVehicles: true } });
    const kinds = await run();
    expect(kinds).toEqual(["VEHICLE_REGISTERED", "VEHICLE_VERIFIED", "VEHICLE_LISTED"]);
    const v = await prisma.vehicleQueue.findFirstOrThrow();
    expect(v.demo).toBe(true);
    expect(v.status).toBe("LISTED");
    const offering = await prisma.offering.findUniqueOrThrow({ where: { projectIdOnchain: v.projectIdOnchain! } });
    expect(offering.status).toBe("OPEN");
    expect(offering.unitPrice.toFixed()).toBe(UNIT_PRICE.toString());
    const project = await prisma.project.findUniqueOrThrow({ where: { projectIdOnchain: v.projectIdOnchain! } });
    expect(project.termDays).toBe(720);
    expect((await prisma.projectMeta.findUniqueOrThrow({ where: { projectIdOnchain: v.projectIdOnchain! } })).title).toBe(v.title);
    // One open offering is the default; nothing else is listed meanwhile.
    expect(await prisma.vehicleQueue.count()).toBe(1);
  }, 120_000);

  it("leaves the offering alone until close to its end", async () => {
    await prisma.matchmakerSettings.update({ where: { chainId: CHAIN }, data: { backstopEnabled: true, backstopHoursBeforeEnd: 24, backstopMaxUsdt: 100_000 } });
    const v = await prisma.vehicleQueue.findFirstOrThrow();
    const alice = c.accounts[7]!;
    await send(c, alice, { address: usdt, abi: mintAbi, functionName: "mint", args: [alice, 30n * UNIT_PRICE] });
    await send(c, alice, { address: usdt, abi: erc20Abi, functionName: "approve", args: [c.addr.SubscriptionRouter!, 2n ** 256n - 1n] });
    await send(c, alice, { address: c.addr.SubscriptionRouter!, abi: subscriptionRouterAbi, functionName: "subscribe", args: [v.projectIdOnchain as Hex, 30, 30n * UNIT_PRICE] });
    expect(await run(2)).toEqual([]);
  }, 60_000);

  it("reports a platform wallet without enough USDT", async () => {
    await c.test.increaseTime({ seconds: 2 * 86_400 + 600 });
    await c.test.mine({ blocks: 1 });
    expect(await run(2)).toEqual(["BACKSTOP_SHORT"]);
  }, 60_000);

  it("fills the rest from the platform wallet, then the vehicle settles and waits to start operating", async () => {
    await send(c, c.accounts[0]!, { address: usdt, abi: mintAbi, functionName: "mint", args: [backstop, 1_000_000n * ONE] });
    const v = await prisma.vehicleQueue.findFirstOrThrow();
    const pid = v.projectIdOnchain as Hex;
    expect(await run(2)).toEqual(["BACKSTOP_FILLED"]);
    const offering = await offeringOf(pid);
    expect(await c.pub.readContract({ address: offering, abi: offeringManagerAbi, functionName: "unitsOf", args: [backstop] })).toBe(70);
    expect(await c.pub.readContract({ address: offering, abi: offeringManagerAbi, functionName: "unitsSold" })).toBe(100);
    // The investor's own USDT was untouched by the platform's purchase.
    expect(await c.pub.readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [c.accounts[7]!] })).toBe(0n);

    // The auto-settler (or anyone) settles; the matchmaker then queues "start operating" for the Safe, once.
    await send(c, c.accounts[8]!, { address: offering, abi: offeringManagerAbi, functionName: "settle" });
    await prisma.matchmakerSettings.update({ where: { chainId: CHAIN }, data: { launchEnabled: false } });
    expect(await run(3)).toEqual(["ACTIVATE_QUEUED"]);
    const q = await prisma.safeTx.findFirstOrThrow({ where: { to: c.addr.AssetRegistry!.toLowerCase() } });
    expect(q.status).toBe("PENDING");
    // The queued call really moves the project to ACTIVE when the Safe executes it.
    await asSafe(c, (safe) => send(c, safe, { address: q.to as Address, abi: assetRegistryAbi, functionName: "transition", args: [pid, 5, ACTIVATE_REASON] }));
    await indexer.catchUp();
    expect((await prisma.project.findUniqueOrThrow({ where: { projectIdOnchain: pid } })).state).toBe("ACTIVE");
  }, 120_000);

  it("in Safe mode, lists a queued vehicle once the owners execute the proposal", async () => {
    await prisma.matchmakerSettings.update({ where: { chainId: CHAIN }, data: { launchEnabled: true, launchMode: "SAFE", demoVehicles: false } });
    await prisma.vehicleQueue.create({
      data: { chainId: CHAIN, slug: "byd-e6-0001", title: "BYD e6 #0001", make: "BYD", model: "e6", assetRef: "vin-hash-0001", createdBy: "staff" },
    });
    const kinds = await run(5);
    expect(kinds).toEqual(["VEHICLE_REGISTERED", "VEHICLE_VERIFIED", "LAUNCH_QUEUED"]);
    const v = await prisma.vehicleQueue.findUniqueOrThrow({ where: { slug: "byd-e6-0001" } });
    expect(v.status).toBe("WAITING_SAFE");
    const q = await prisma.safeTx.findUniqueOrThrow({ where: { id: v.safeTxId! } });
    await asSafe(c, (safe) => c.wallet.sendTransaction({ account: safe, chain: null, to: q.to as Address, data: q.data as Hex }));
    await c.test.mine({ blocks: 1 });
    expect(await run(2)).toEqual(["VEHICLE_LISTED"]);
    const pid = projectIdForSlug("byd-e6-0001");
    expect(await offeringOf(pid)).not.toBe("0x0000000000000000000000000000000000000000");
    expect((await prisma.vehicleQueue.findUniqueOrThrow({ where: { slug: "byd-e6-0001" } })).status).toBe("LISTED");
  }, 120_000);
});
