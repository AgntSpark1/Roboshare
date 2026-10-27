import { PrismaClient } from "@roboshare/db";
import {
  allocate,
  assetRegistryAbi,
  auditRegistryAbi,
  buildReferralTree,
  offeringManagerAbi,
  projectFactoryAbi,
  referralRewards,
  REFERRAL_LEVEL_BPS,
  referralRewardsAbi,
  revenueDistributorAbi,
  subscriptionRouterAbi,
  tiersForTerm,
  DEFAULT_TERM_DAYS,
} from "@roboshare/shared";
import { erc20Abi, keccak256, parseAbi, stringToHex, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Indexer } from "../src/indexer.js";
import { asSafe, bytes32, resetDb, send, startAnvil, type Chain } from "./anvil.js";

const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const ONE = 10n ** 18n;
const UNIT_PRICE = 1_000n * ONE;
const PID = keccak256(stringToHex("e2e-referral-project"));
const MAX = 2n ** 256n - 1n;

let c: Chain;
let prisma: PrismaClient;
let indexer: Indexer;
let A: Record<string, Address>;
let offering: Address;
let distributor: Address;
const lc = (a: string) => a.toLowerCase();

beforeAll(async () => {
  c = await startAnvil(18546);
  prisma = new PrismaClient();
  await resetDb(prisma);
  // anvil has 10 accounts; the pauser has no role in these flows, so it doubles as investor erin.
  const [treasury, dave, operator, reviewer, erin, agent, feeRecipient, alice, bob, carol] = c.accounts;
  A = { operator: operator!, reviewer: reviewer!, agent: agent!, feeRecipient: feeRecipient!, alice: alice!, bob: bob!, carol: carol!, dave: dave!, erin: erin!, treasury: treasury! };
  indexer = new Indexer(prisma, c.pub as any, {
    chainId: 31337,
    rpcUrl: c.rpcUrl,
    assetRegistry: c.addr.AssetRegistry!,
    auditRegistry: c.addr.AuditRegistry!,
    identityRegistry: c.addr.IdentityRegistry!,
    subscriptionRouter: c.addr.SubscriptionRouter!,
    projectFactory: c.addr.ProjectFactory!,
    referralRewards: c.addr.ReferralRewards!,
    startBlock: 0n,
    confirmations: 0,
    batchSize: 50,
  });
  await indexer.init();
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  c?.stop();
});

async function subscribe(who: Address, units: number, referrer?: Address) {
  const cost = BigInt(units) * UNIT_PRICE;
  await send(c, who, { address: c.addr.MockUSDT!, abi: mintAbi, functionName: "mint", args: [who, cost] });
  await send(c, who, { address: c.addr.MockUSDT!, abi: erc20Abi, functionName: "approve", args: [c.addr.SubscriptionRouter!, MAX] });
  if (referrer) {
    await send(c, who, { address: c.addr.SubscriptionRouter!, abi: subscriptionRouterAbi, functionName: "subscribeWithReferrer", args: [PID, units, cost, referrer] });
  } else {
    await send(c, who, { address: c.addr.SubscriptionRouter!, abi: subscriptionRouterAbi, functionName: "subscribe", args: [PID, units, cost] });
  }
}

describe("referral rewards against a local chain", () => {
  it("binds referrals with the terms in force at bind time", async () => {
    await send(c, A.operator!, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "registerProject", args: [PID, bytes32("asset-r"), bytes32("issuer-r"), bytes32("rights-r")] });
    await send(c, A.reviewer!, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "transition", args: [PID, 2, bytes32("kyb ok")] });
    await asSafe(c, (tl) =>
      send(c, tl, {
        address: c.addr.ProjectFactory!, abi: projectFactoryAbi, functionName: "deployProject",
        args: [{ projectId: PID, name: "RoboShare Vehicle R", symbol: "RSVR", treasury: A.treasury }],
      }),
    );
    offering = (await c.pub.readContract({ address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "offeringOf", args: [PID] })) as Address;
    const now = (await c.pub.getBlock()).timestamp;
    await asSafe(c, async (tl) => {
      await send(c, tl, {
        address: offering, abi: offeringManagerAbi, functionName: "configure",
        args: [{ unitPrice: UNIT_PRICE, minUnits: 100, maxUnits: 100, perWalletMax: 100, startTime: now, endTime: now + 86_400n, treasury: A.treasury, termsHash: bytes32("terms-r") }],
      });
      await send(c, tl, { address: offering, abi: offeringManagerAbi, functionName: "open" });
      await send(c, tl, { address: c.addr.SubscriptionRouter!, abi: subscriptionRouterAbi, functionName: "setReferralTerms", args: [true, 2_000, 365n * 86_400n] });
    });
    await subscribe(A.alice!, 40);
    await subscribe(A.bob!, 30, A.alice!);
    await subscribe(A.dave!, 5, A.bob!); // alice is dave's second level
    await subscribe(A.erin!, 5, A.dave!); // dave → bob → alice are erin's three levels
    // Shorter terms apply only to bindings made from now on.
    await asSafe(c, (tl) =>
      send(c, tl, { address: c.addr.SubscriptionRouter!, abi: subscriptionRouterAbi, functionName: "setReferralTerms", args: [true, 2_000, 3_600n] }),
    );
    await subscribe(A.carol!, 20, A.bob!);
    await send(c, A.operator!, { address: offering, abi: offeringManagerAbi, functionName: "settle" });
    await asSafe(c, (tl) => send(c, tl, { address: c.addr.AssetRegistry!, abi: assetRegistryAbi, functionName: "transition", args: [PID, 5, bytes32("go live")] }));

    await indexer.catchUp();
    const refs = await prisma.referral.findMany({ orderBy: { boundBlock: "asc" } });
    expect(refs.map((r) => [r.referee, r.referrer])).toEqual([
      [lc(A.bob!), lc(A.alice!)],
      [lc(A.dave!), lc(A.bob!)],
      [lc(A.erin!), lc(A.dave!)],
      [lc(A.carol!), lc(A.bob!)],
    ]);
    expect(refs[3]!.expiresAt.getTime() - refs[0]!.expiresAt.getTime()).toBeLessThan(0);
    // The distributor's own tiers are recorded: new projects pay a flat 30% platform share.
    expect((await prisma.project.findUniqueOrThrow({ where: { projectIdOnchain: PID } })).feeTiers).toEqual([{ minUnits: 1, bps: 3000 }]);
  }, 90_000);

  it("accrues up to three levels on approval from the platform share, skipping expired bindings", async () => {
    await c.test.increaseTime({ seconds: 7_200 }); // carol's 1h binding lapses, bob's 1y binding does not
    await c.test.mine({ blocks: 1 });
    const amount = 10_000n * ONE;
    await send(c, A.operator!, {
      address: c.addr.AuditRegistry!, abi: auditRegistryAbi, functionName: "submitRecord",
      args: [{ projectId: PID, kind: 1, contentHash: bytes32("report-r"), docType: bytes32("PNL_REPORT"), offchainRef: bytes32("key"), periodStart: 1n, periodEnd: 2n, distributableAmount: amount, paymentToken: c.addr.MockUSDT! }],
    });
    const recordId = (await c.pub.readContract({ address: c.addr.AuditRegistry!, abi: auditRegistryAbi, functionName: "computeRecordId", args: [PID, 1, bytes32("report-r")] })) as Hex;
    await send(c, A.reviewer!, { address: c.addr.AuditRegistry!, abi: auditRegistryAbi, functionName: "approve", args: [recordId] });
    distributor = ((await prisma.project.findUniqueOrThrow({ where: { projectIdOnchain: PID } })).distributorAddress) as Address;
    await send(c, A.treasury!, { address: c.addr.MockUSDT!, abi: mintAbi, functionName: "mint", args: [A.treasury!, amount] });
    await send(c, A.treasury!, { address: c.addr.MockUSDT!, abi: erc20Abi, functionName: "approve", args: [distributor, amount] });
    const snap = (await c.pub.getBlockNumber()) - 1n;
    const holders = [A.alice!, A.bob!, A.carol!, A.dave!, A.erin!].sort((x, y) => (lc(x) < lc(y) ? -1 : 1));
    await send(c, A.operator!, { address: distributor, abi: revenueDistributorAbi, functionName: "proposeBatch", args: [recordId, amount, snap, holders] });
    await send(c, A.reviewer!, { address: distributor, abi: revenueDistributorAbi, functionName: "approveBatch", args: [1n] });

    await indexer.catchUp();
    const accruals = await prisma.referralAccrual.findMany({ orderBy: [{ referee: "asc" }, { level: "asc" }] });
    const allocs = allocate(amount, 0n, [
      { address: "alice", units: 40 },
      { address: "bob", units: 30 },
      { address: "carol", units: 20 },
      { address: "dave", units: 5 },
      { address: "erin", units: 5 },
    ], tiersForTerm(DEFAULT_TERM_DAYS)).allocations;
    const of = (who: string) => allocs.find((f) => f.address === who)!;
    const row = (referee: string, level: number, referrer: string) => ({
      referee: lc(A[referee]!), level, referrer: lc(A[referrer]!), gross: of(referee).gross, bps: REFERRAL_LEVEL_BPS[level - 1]!,
      reward: referralRewards(of(referee).gross, of(referee).fee)[level - 1]!,
    });
    // carol's binding lapsed, so neither bob nor alice earns on her. erin pays three levels.
    const expected = [
      row("bob", 1, "alice"),
      row("dave", 1, "bob"),
      row("dave", 2, "alice"),
      row("erin", 1, "dave"),
      row("erin", 2, "bob"),
      row("erin", 3, "alice"),
    ].sort((x, y) => (x.referee < y.referee ? -1 : x.referee > y.referee ? 1 : x.level - y.level));
    expect(
      accruals.map((a) => ({ referee: a.referee, level: a.level, referrer: a.referrer, gross: BigInt(a.gross.toFixed()), bps: a.shareBps, reward: BigInt(a.reward.toFixed()) })),
    ).toEqual(expected);
    // 500 USDT gross for erin: 50 / 25 / 15 out of the 150 platform share.
    expect(expected.filter((x) => x.referee === lc(A.erin!)).map((x) => x.reward)).toEqual([50n * ONE, 25n * ONE, 15n * ONE]);
  }, 90_000);

  it("pays the referrer by Merkle proof from platform-funded balance", async () => {
    const sum = await prisma.referralAccrual.aggregate({ where: { referrer: lc(A.alice!) }, _sum: { reward: true } });
    const reward = BigInt(sum._sum.reward!.toFixed()); // alice: level 1 on bob, level 2 on dave, level 3 on erin
    const tree = buildReferralTree([{ account: A.alice!, cumulative: reward }]);
    const rewards = c.addr.ReferralRewards!;
    await send(c, A.operator!, { address: rewards, abi: referralRewardsAbi, functionName: "setRoot", args: [tree.root, bytes32("file"), tree.totalCumulative] });
    // Platform tops up from the fee income it received at approval.
    await send(c, A.feeRecipient!, { address: c.addr.MockUSDT!, abi: erc20Abi, functionName: "transfer", args: [rewards, reward] });
    await asSafe(c, (tl) => send(c, tl, { address: rewards, abi: referralRewardsAbi, functionName: "setClaimsEnabled", args: [true] }));
    const before = (await c.pub.readContract({ address: c.addr.MockUSDT!, abi: erc20Abi, functionName: "balanceOf", args: [A.alice!] })) as bigint;
    await send(c, A.alice!, { address: rewards, abi: referralRewardsAbi, functionName: "claim", args: [A.alice!, reward, tree.entries[0]!.proof] });
    const after = (await c.pub.readContract({ address: c.addr.MockUSDT!, abi: erc20Abi, functionName: "balanceOf", args: [A.alice!] })) as bigint;
    expect(after - before).toBe(reward);

    await indexer.catchUp();
    const root = await prisma.referralRoot.findUniqueOrThrow({ where: { epoch: 1 } });
    expect(root.root).toBe(tree.root);
    const claim = await prisma.referralClaim.findUniqueOrThrow({ where: { account: lc(A.alice!) } });
    expect(claim.claimed.toFixed()).toBe(reward.toString());
  }, 90_000);
});
