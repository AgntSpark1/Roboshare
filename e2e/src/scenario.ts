// TEST-ONLY chain steps the browser suite does not drive through a UI: governance (the 2/3 Safe + timelock,
// impersonated here), the compliance agent's eligibility updates, test USDT minting and the treasury's funding.
import { PrismaClient } from "@roboshare/db";
import { assetRegistryAbi, identityRegistryAbi, offeringManagerAbi, projectFactoryAbi } from "@roboshare/shared";
import { erc20Abi, keccak256, parseAbi, stringToHex, type Abi, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { PORTS, ROLES } from "./accounts.ts";
import { clients, type StackState } from "./stack.ts";

const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
export const ONE = 10n ** 18n;
export const bytes32 = (s: string): Hex => `0x${Buffer.from(s).toString("hex").padEnd(64, "0")}` as Hex;
/** Same id the API derives in POST /admin/projects. */
export const projectIdOf = (slug: string) => keccak256(stringToHex(`roboshare:project:${slug}`));

export function scenario(state: StackState) {
  const { pub, wallet, test } = clients(state.rpcUrl);
  const A = state.addr;

  async function send(from: Address, req: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }) {
    const hash = await wallet.writeContract({ account: from, chain: foundry, ...req } as never);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${req.functionName} reverted`);
    return r;
  }

  async function asTimelock<T>(fn: (tl: Address) => Promise<T>) {
    const tl = A.TimelockController!;
    await test.impersonateAccount({ address: tl });
    await test.setBalance({ address: tl, value: 10n ** 20n });
    try {
      return await fn(tl);
    } finally {
      await test.stopImpersonatingAccount({ address: tl });
    }
  }

  /** Waits until the indexer has caught up with the chain head. */
  async function indexed() {
    const head = await pub.getBlockNumber();
    for (let i = 0; i < 200; i++) {
      const h = (await (await fetch(`http://127.0.0.1:${PORTS.api}/api/v1/health`)).json()) as { indexer: { lastBlock: string } | null };
      if (h.indexer && BigInt(h.indexer.lastBlock) >= head) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error("indexer did not catch up");
  }

  return {
    pub,
    send,
    indexed,

    /** Registers, verifies and deploys a project, then configures and opens its offering (as governance would). */
    async openOffering(o: { slug: string; title: string; unitPrice: bigint; minUnits: number; perWalletMax: number; durationSec: number }) {
      const pid = projectIdOf(o.slug);
      await send(ROLES.operator, { address: A.AssetRegistry!, abi: assetRegistryAbi as Abi, functionName: "registerProject", args: [pid, bytes32(`asset-${o.slug}`), bytes32("issuer-1"), bytes32(`rights-${o.slug}`)] });
      const prisma = new PrismaClient({ datasourceUrl: state.databaseUrl });
      await prisma.projectMeta.create({
        data: { projectIdOnchain: pid, slug: o.slug, title: o.title, make: "示例车型", model: "Robotaxi L4（TEST-ONLY）", summary: "测试链上的示例项目，用于端到端测试与演示，不是真实车辆。" },
      });
      await prisma.$disconnect();
      await send(ROLES.reviewer, { address: A.AssetRegistry!, abi: assetRegistryAbi as Abi, functionName: "transition", args: [pid, 2, bytes32("kyb ok")] });
      await asTimelock((tl) =>
        send(tl, {
          address: A.ProjectFactory!,
          abi: projectFactoryAbi as Abi,
          functionName: "deployProject",
          args: [{ projectId: pid, name: `RoboShare ${o.slug}`, symbol: o.slug.replace(/[^A-Z0-9]/gi, "").slice(0, 8).toUpperCase(), allowedClassesMask: 2n, treasury: ROLES.treasury }],
        }),
      );
      const offering = (await pub.readContract({ address: A.AssetRegistry!, abi: assetRegistryAbi, functionName: "offeringOf", args: [pid] })) as Address;
      const now = (await pub.getBlock()).timestamp;
      await asTimelock(async (tl) => {
        await send(tl, {
          address: offering,
          abi: offeringManagerAbi as Abi,
          functionName: "configure",
          args: [{ unitPrice: o.unitPrice, minUnits: o.minUnits, maxUnits: 100, perWalletMax: o.perWalletMax, startTime: now, endTime: now + BigInt(o.durationSec), treasury: ROLES.treasury, termsHash: bytes32("terms-v1") }],
        });
        await send(tl, { address: offering, abi: offeringManagerAbi as Abi, functionName: "open" });
      });
      return { pid, offering, endTime: now + BigInt(o.durationSec) };
    },

    /** Compliance agent marks a wallet eligible (interim manual KYC; no real KYC provider yet). */
    async kyc(who: Address) {
      const now = (await pub.getBlock()).timestamp;
      await send(ROLES.agent, { address: A.IdentityRegistry!, abi: identityRegistryAbi as Abi, functionName: "setEligibility", args: [who, 1, 840, now + 365n * 86_400n, bytes32("manual-test")] });
    },

    async mintUsdt(to: Address, amount: bigint) {
      await send(to, { address: A.MockUSDT!, abi: mintAbi, functionName: "mint", args: [to, amount] });
    },

    async warpPast(t: bigint) {
      const now = (await pub.getBlock()).timestamp;
      if (now <= t) await test.increaseTime({ seconds: Number(t - now) + 1 });
      await test.mine({ blocks: 1 });
    },

    /** FUNDED -> ACTIVE needs the timelock (vehicle in service). */
    async activate(pid: Hex) {
      await asTimelock((tl) => send(tl, { address: A.AssetRegistry!, abi: assetRegistryAbi as Abi, functionName: "transition", args: [pid, 5, bytes32("in service")] }));
    },

    /** The treasury funds distributions: approveBatch pulls the batch amount from it. */
    async fundTreasury(distributor: Address, amount: bigint) {
      await send(ROLES.treasury, { address: A.MockUSDT!, abi: mintAbi, functionName: "mint", args: [ROLES.treasury, amount] });
      await send(ROLES.treasury, { address: A.MockUSDT!, abi: erc20Abi as Abi, functionName: "approve", args: [distributor, amount] });
    },

    async tokenOf(pid: Hex) {
      const p = (await pub.readContract({ address: A.AssetRegistry!, abi: assetRegistryAbi, functionName: "getProject", args: [pid] })) as { token: Address };
      return p.token;
    },

    async distributorOf(pid: Hex) {
      const p = (await pub.readContract({ address: A.AssetRegistry!, abi: assetRegistryAbi, functionName: "getProject", args: [pid] })) as { distributor: Address };
      return p.distributor;
    },
  };
}
