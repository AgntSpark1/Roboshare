import type { PrismaClient } from "@roboshare/db";
import { assetRegistryAbi, offeringManagerAbi, projectFactoryAbi, subscriptionRouterAbi } from "@roboshare/shared";
import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  maxUint256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * Robot matchmaking (MATCHMAKER_DESIGN.md, Charlene 2026-10-14): keeps a vehicle on sale and gets funded vehicles into
 * service without anyone clicking.
 *
 * 1. Listing. When fewer than `maxOpen` offerings are open, the next queued vehicle is registered and verified on the
 *    AssetRegistry and its offering opened through ProjectFactory.launch on the Safe's launch template. In AUTO mode
 *    the launcher wallet calls launch (it holds LAUNCHER_ROLE); in SAFE mode the worker queues one Safe transaction per
 *    vehicle for the owners to confirm in the console. The launcher cannot pick price, size, window or treasury.
 * 2. Backstop. In the last `backstopHoursBeforeEnd` of an offering (subscriptions close at the end), one platform wallet
 *    buys all unsold units in a single purchase with the platform's own USDT through the normal router (its own
 *    transaction, from its own balance). It never buys during the sale to move the progress bar and is never split across
 *    wallets posing as separate investors. The risk disclosure says the platform may buy unsold units.
 * 3. Activation. Once an automatically listed vehicle is funded (the auto-settler settles it), the worker queues the
 *    Safe transaction that puts it into service; starting operation stays a governance attestation.
 */
export interface MatchmakerConfig {
  chainId: number;
  rpcUrl: string;
  assetRegistry: Address;
  projectFactory: Address;
  subscriptionRouter: Address;
  paymentToken?: Address;
  safe?: Address;
  /** OPERATOR_ROLE on the AssetRegistry (register, set term) and, in AUTO mode, LAUNCHER_ROLE on the factory. */
  launcherKey?: Hex;
  /** REVIEWER_ROLE on the AssetRegistry (verify). Must differ from the launcher: the registry refuses self-approval. */
  verifierKey?: Hex;
  /** No role. Holds the platform's own USDT and gas for the backstop. */
  backstopKey?: Hex;
  issuerId: Hex;
  rightsDocHash: Hex;
}

export interface MatchmakerEvent {
  projectId: string;
  kind: string;
  message: string;
  txHash?: string;
}

/** Reason hash of the activation the worker queues; fixed so a queued proposal is recognised again. */
export const ACTIVATE_REASON = keccak256(stringToHex("roboshare:matchmaker:in-service"));
const RECEIPT_TIMEOUT_MS = 120_000;
const ISSUE_REPEAT_MS = 6 * 3600_000;
const ONE_USDT = 10n ** 18n;

const State = { NONE: 0, DRAFT: 1, VERIFIED: 2, OFFERING: 3, FUNDED: 4, ACTIVE: 5, CANCELLED: 10 } as const;

export function projectIdForSlug(slug: string): Hex {
  return keccak256(stringToHex(`roboshare:project:${slug}`));
}

export function loadMatchmakerConfig(env: NodeJS.ProcessEnv = process.env): MatchmakerConfig | null {
  if (env.MATCHMAKER_ENABLED === "false") return null;
  const launcherKey = (env.MATCHMAKER_LAUNCHER_KEY || env.AUTOPILOT_SUBMITTER_KEY || undefined) as Hex | undefined;
  const verifierKey = (env.MATCHMAKER_VERIFIER_KEY || env.AUTOPILOT_APPROVER_KEY || undefined) as Hex | undefined;
  const backstopKey = (env.BACKSTOP_PRIVATE_KEY || undefined) as Hex | undefined;
  if (!launcherKey && !backstopKey) return null;
  if (launcherKey && verifierKey && launcherKey.toLowerCase() === verifierKey.toLowerCase()) {
    throw new Error("MATCHMAKER_LAUNCHER_KEY and MATCHMAKER_VERIFIER_KEY must differ");
  }
  return {
    chainId: Number(env.CHAIN_ID),
    rpcUrl: env.RPC_URL!,
    assetRegistry: getAddress(env.ASSET_REGISTRY!),
    projectFactory: getAddress(env.PROJECT_FACTORY!),
    subscriptionRouter: getAddress(env.SUBSCRIPTION_ROUTER!),
    paymentToken: env.PAYMENT_TOKEN ? getAddress(env.PAYMENT_TOKEN) : undefined,
    safe: env.SAFE ? getAddress(env.SAFE) : undefined,
    launcherKey,
    verifierKey,
    backstopKey,
    issuerId: (env.MATCHMAKER_ISSUER_ID as Hex) || keccak256(stringToHex("roboshare:issuer:platform")),
    rightsDocHash: (env.MATCHMAKER_RIGHTS_DOC_HASH as Hex) || keccak256(stringToHex("roboshare:rights:standard-vehicle-v1")),
  };
}

type Settings = NonNullable<Awaited<ReturnType<PrismaClient["matchmakerSettings"]["findUnique"]>>>;
type Vehicle = NonNullable<Awaited<ReturnType<PrismaClient["vehicleQueue"]["findFirst"]>>>;

export class Matchmaker {
  readonly launcher?: PrivateKeyAccount;
  readonly verifier?: PrivateKeyAccount;
  readonly backstop?: PrivateKeyAccount;
  private readonly lastIssue = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly pub: PublicClient,
    private readonly cfg: MatchmakerConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (cfg.launcherKey) this.launcher = privateKeyToAccount(cfg.launcherKey);
    if (cfg.verifierKey) this.verifier = privateKeyToAccount(cfg.verifierKey);
    if (cfg.backstopKey) this.backstop = privateKeyToAccount(cfg.backstopKey);
  }

  /** Publishes the wallets' public addresses so the console and the site can name them. */
  async init(): Promise<Settings> {
    const addresses = {
      launcherAddress: this.launcher?.address.toLowerCase() ?? null,
      verifierAddress: this.verifier?.address.toLowerCase() ?? null,
      backstopAddress: this.backstop?.address.toLowerCase() ?? null,
    };
    return this.prisma.matchmakerSettings.upsert({
      where: { chainId: this.cfg.chainId },
      update: addresses,
      create: { chainId: this.cfg.chainId, ...addresses },
    });
  }

  async tick(): Promise<MatchmakerEvent[]> {
    const events: MatchmakerEvent[] = [];
    const s = await this.prisma.matchmakerSettings.findUnique({ where: { chainId: this.cfg.chainId } });
    if (!s) return events;
    const t = await this.template();
    const shown = { ...t, unitPrice: t.unitPrice.toString(), lastLaunchAt: t.lastLaunchAt.toString() };
    if (JSON.stringify(s.template) !== JSON.stringify(shown)) {
      await this.prisma.matchmakerSettings.update({ where: { chainId: this.cfg.chainId }, data: { template: shown } });
    }
    const steps: [boolean, () => Promise<void>][] = [
      [s.launchEnabled, () => this.list(s, events)],
      [s.backstopEnabled, () => this.fill(s, events)],
      [s.autoActivate, () => this.activate(events)],
    ];
    for (const [on, step] of steps) {
      if (!on) continue;
      try {
        await step();
      } catch (err) {
        await this.issue(events, "-", "MATCHMAKER_BLOCKED", String(err).split("\n")[0]!.slice(0, 300));
      }
    }
    for (const e of events) {
      await this.prisma.automationEvent.create({ data: { chainId: this.cfg.chainId, projectIdOnchain: e.projectId, kind: e.kind, message: e.message, txHash: e.txHash } });
    }
    return events;
  }

  // ------------------------------------------------------------------ 1. listing

  private async list(s: Settings, events: MatchmakerEvent[]) {
    if (!this.launcher || !this.verifier) {
      await this.issue(events, "-", "MATCHMAKER_BLOCKED", "automatic listing needs MATCHMAKER_LAUNCHER_KEY and MATCHMAKER_VERIFIER_KEY on the worker");
      return;
    }
    // A vehicle already on its way is finished first, one step per tick.
    let v = await this.prisma.vehicleQueue.findFirst({
      where: { chainId: this.cfg.chainId, status: { in: ["REGISTERING", "WAITING_SAFE"] } },
      orderBy: { createdAt: "asc" },
    });
    if (!v) {
      if ((await this.openCount()) >= s.maxOpen) return;
      const t = await this.template();
      if (!t.enabled) {
        await this.issue(events, "-", "MATCHMAKER_BLOCKED", "the launch template is off; set it on the console's matchmaking page");
        return;
      }
      v = await this.prisma.vehicleQueue.findFirst({ where: { chainId: this.cfg.chainId, status: "QUEUED" }, orderBy: { createdAt: "asc" } });
      if (!v && s.demoVehicles && this.cfg.chainId !== 56) v = await this.demoVehicle();
      if (!v) return;
    }
    await this.advance(s, v, events);
  }

  private async advance(s: Settings, v: Vehicle, events: MatchmakerEvent[]) {
    const pid = projectIdForSlug(v.slug);
    const reg = this.cfg.assetRegistry;
    if (!v.projectIdOnchain) {
      await this.prisma.projectMeta.upsert({
        where: { projectIdOnchain: pid },
        update: {},
        create: { projectIdOnchain: pid, slug: v.slug, title: v.title, make: v.make, model: v.model, modelYear: v.modelYear, summary: v.summary },
      });
      v = await this.prisma.vehicleQueue.update({ where: { id: v.id }, data: { projectIdOnchain: pid, status: "REGISTERING" } });
    }
    const t = await this.template();
    const state = Number(await this.read(reg, assetRegistryAbi, "stateOf", [pid]));

    if (state === State.NONE) {
      const hash = await this.send(this.launcher!, reg, assetRegistryAbi, "registerProject", [pid, keccak256(stringToHex(v.assetRef)), this.cfg.issuerId, this.cfg.rightsDocHash]);
      events.push({ projectId: pid, kind: "VEHICLE_REGISTERED", message: v.title, txHash: hash });
      return;
    }
    if (state === State.DRAFT || state === State.VERIFIED) {
      const [termDays] = (await this.read(reg, assetRegistryAbi, "termOf", [pid])) as [number, bigint, bigint];
      const linked = ((await this.read(reg, assetRegistryAbi, "offeringOf", [pid])) as Address) !== "0x0000000000000000000000000000000000000000";
      if (!linked && termDays !== t.termDays) {
        await this.send(this.launcher!, reg, assetRegistryAbi, "setOperatingTerm", [pid, t.termDays]);
        return;
      }
      if (state === State.DRAFT) {
        const hash = await this.send(this.verifier!, reg, assetRegistryAbi, "transition", [pid, State.VERIFIED, this.cfg.rightsDocHash]);
        events.push({ projectId: pid, kind: "VEHICLE_VERIFIED", message: v.title, txHash: hash });
        return;
      }
      const symbol = `RS${v.slug.replace(/[^a-z0-9]/g, "").toUpperCase().slice(-8)}`;
      const args = [pid, v.title.slice(0, 64), symbol] as const;
      if (s.launchMode === "AUTO") {
        const next = t.lastLaunchAt === 0n ? 0n : t.lastLaunchAt + BigInt(t.minLaunchInterval);
        if (BigInt(Math.floor(this.now().getTime() / 1000)) < next) return; // the template's rate limit
        const hash = await this.send(this.launcher!, this.cfg.projectFactory, projectFactoryAbi, "launch", [...args]);
        await this.prisma.vehicleQueue.update({ where: { id: v.id }, data: { status: "LISTED", listedAt: this.now() } });
        events.push({ projectId: pid, kind: "VEHICLE_LISTED", message: `${v.title} is on sale`, txHash: hash });
        return;
      }
      if (v.status === "WAITING_SAFE" && v.safeTxId) {
        const q = await this.prisma.safeTx.findUnique({ where: { id: v.safeTxId } });
        if (q?.status === "CANCELLED") {
          await this.prisma.vehicleQueue.update({ where: { id: v.id }, data: { status: "FAILED", lastError: "Safe owners cancelled the listing" } });
        }
        return;
      }
      const id = await this.queueSafe(this.cfg.projectFactory, encodeFunctionData({ abi: projectFactoryAbi, functionName: "launch", args: [...args] }), `撮合：上架 ${v.title}`);
      if (!id) {
        await this.prisma.vehicleQueue.update({ where: { id: v.id }, data: { status: "FAILED", lastError: "a Safe listing proposal for this vehicle already exists" } });
        return;
      }
      await this.prisma.vehicleQueue.update({ where: { id: v.id }, data: { status: "WAITING_SAFE", safeTxId: id } });
      events.push({ projectId: pid, kind: "LAUNCH_QUEUED", message: `${v.title} waits for two Safe confirmations` });
      return;
    }
    if (state === State.CANCELLED) {
      await this.prisma.vehicleQueue.update({ where: { id: v.id }, data: { status: "FAILED", lastError: "project cancelled" } });
      return;
    }
    // OFFERING or later: listed (by the launcher, the Safe, or staff by hand).
    await this.prisma.vehicleQueue.update({ where: { id: v.id }, data: { status: "LISTED", listedAt: v.listedAt ?? this.now() } });
    if (v.status === "WAITING_SAFE") events.push({ projectId: pid, kind: "VEHICLE_LISTED", message: `${v.title} is on sale` });
  }

  /** Open offerings, counting a vehicle just listed whose offering the indexer has not seen yet. */
  private async openCount(): Promise<number> {
    const open = await this.prisma.offering.count({ where: { status: "OPEN" } });
    const listed = await this.prisma.vehicleQueue.findMany({ where: { chainId: this.cfg.chainId, status: "LISTED" }, select: { projectIdOnchain: true } });
    const ids = listed.map((v) => v.projectIdOnchain!).filter(Boolean);
    const indexed = await this.prisma.offering.count({ where: { projectIdOnchain: { in: ids } } });
    return open + ids.length - indexed;
  }

  /** Testnet only: the next demo vehicle, labeled as a demo on the site. */
  private async demoVehicle(): Promise<Vehicle> {
    const n = (await this.prisma.vehicleQueue.count({ where: { chainId: this.cfg.chainId, demo: true } })) + 1;
    const stamp = this.now().toISOString().slice(0, 10).replace(/-/g, "");
    const slug = `demo-robotaxi-${stamp}-${n}`;
    return this.prisma.vehicleQueue.create({
      data: {
        chainId: this.cfg.chainId,
        slug,
        title: `Robotaxi 演示车 #${n}`,
        make: "Demo",
        model: "Robotaxi",
        modelYear: this.now().getUTCFullYear(),
        summary: "测试网演示车辆，由撮合系统自动创建，不代表真实车辆。",
        assetRef: `testnet-demo:${slug}`,
        demo: true,
        createdBy: "matchmaker",
      },
    });
  }

  private async template() {
    const t = (await this.read(this.cfg.projectFactory, projectFactoryAbi, "launchTemplate")) as readonly [boolean, bigint, number, number, number, number, number, Address, Hex];
    const lastLaunchAt = (await this.read(this.cfg.projectFactory, projectFactoryAbi, "lastLaunchAt")) as bigint;
    return {
      enabled: t[0], unitPrice: t[1], minUnits: t[2], perWalletMax: t[3], durationDays: t[4], termDays: t[5],
      minLaunchInterval: t[6], treasury: t[7], termsHash: t[8], lastLaunchAt,
    };
  }

  // ------------------------------------------------------------------ 2. backstop

  private async fill(s: Settings, events: MatchmakerEvent[]) {
    if (!this.backstop) {
      await this.issue(events, "-", "MATCHMAKER_BLOCKED", "the platform backstop needs BACKSTOP_PRIVATE_KEY on the worker");
      return;
    }
    if (!this.cfg.paymentToken) throw new Error("the platform backstop needs PAYMENT_TOKEN");
    const now = this.now();
    const horizon = new Date(now.getTime() + s.backstopHoursBeforeEnd * 3600_000);
    const due = await this.prisma.offering.findMany({ where: { status: "OPEN", endAt: { gt: now, lte: horizon } } });
    const me = this.backstop.address;
    for (const o of due) {
      const offering = getAddress(o.address);
      const pid = o.projectIdOnchain;
      const [sold, mine, cfg, outcome] = await Promise.all([
        this.read(offering, offeringManagerAbi, "unitsSold") as Promise<number>,
        this.read(offering, offeringManagerAbi, "unitsOf", [me]) as Promise<number>,
        this.read(offering, offeringManagerAbi, "config") as Promise<readonly [bigint, number, number, number, bigint, bigint, Address, Hex]>,
        this.read(offering, offeringManagerAbi, "outcome") as Promise<number>,
      ]);
      const [unitPrice, , maxUnits, perWalletMax] = cfg;
      if (Number(outcome) !== 0 || sold >= maxUnits) continue;
      const units = Math.min(maxUnits - sold, perWalletMax - mine);
      if (units <= 0) {
        await this.issue(events, pid, "BACKSTOP_OVER_CAP", `the per-wallet limit leaves the platform no units to buy (${maxUnits - sold} unsold)`);
        continue;
      }
      const cost = BigInt(units) * unitPrice;
      if (cost > BigInt(s.backstopMaxUsdt) * ONE_USDT) {
        await this.issue(events, pid, "BACKSTOP_OVER_CAP", `filling ${units} units costs ${cost / ONE_USDT} USDT, above the platform limit of ${s.backstopMaxUsdt} USDT`);
        continue;
      }
      const [balance, allowance] = await Promise.all([
        this.read(this.cfg.paymentToken, erc20Abi, "balanceOf", [me]) as Promise<bigint>,
        this.read(this.cfg.paymentToken, erc20Abi, "allowance", [me, this.cfg.subscriptionRouter]) as Promise<bigint>,
      ]);
      if (balance < cost) {
        await this.issue(events, pid, "BACKSTOP_SHORT", `the platform wallet ${me} needs ${cost / ONE_USDT} USDT to fill ${units} units (has ${balance / ONE_USDT})`);
        continue;
      }
      // The platform wallet approves and pays from its own balance, like any investor. Nobody else's USDT is touched.
      if (allowance < cost) await this.send(this.backstop, this.cfg.paymentToken, erc20Abi, "approve", [this.cfg.subscriptionRouter, maxUint256]);
      const hash = await this.send(this.backstop, this.cfg.subscriptionRouter, subscriptionRouterAbi, "subscribe", [pid, units, cost]);
      events.push({ projectId: pid, kind: "BACKSTOP_FILLED", message: `platform bought the remaining ${units} units for ${cost / ONE_USDT} USDT`, txHash: hash });
    }
  }

  // ------------------------------------------------------------------ 3. activation

  private async activate(events: MatchmakerEvent[]) {
    const listed = await this.prisma.vehicleQueue.findMany({ where: { chainId: this.cfg.chainId, status: "LISTED", projectIdOnchain: { not: null } } });
    if (!listed.length) return;
    const funded = await this.prisma.project.findMany({ where: { projectIdOnchain: { in: listed.map((v) => v.projectIdOnchain!) }, state: "FUNDED" } });
    for (const p of funded) {
      const data = encodeFunctionData({ abi: assetRegistryAbi, functionName: "transition", args: [p.projectIdOnchain as Hex, State.ACTIVE, ACTIVATE_REASON] });
      const title = listed.find((v) => v.projectIdOnchain === p.projectIdOnchain)?.title ?? p.projectIdOnchain;
      const id = await this.queueSafe(this.cfg.assetRegistry, data, `撮合：${title} 已满额，投入运营`);
      if (id) events.push({ projectId: p.projectIdOnchain, kind: "ACTIVATE_QUEUED", message: `${title} is funded; confirm "start operating" on the Safe page` });
    }
  }

  /** Queues a single Safe call once. The same target and calldata in any state counts as done, so a call the owners
   * cancelled is not proposed again. */
  private async queueSafe(to: Address, data: Hex, description: string): Promise<string | null> {
    if (!this.cfg.safe) throw new Error("queuing Safe transactions needs SAFE on the worker");
    const existing = await this.prisma.safeTx.findFirst({ where: { chainId: this.cfg.chainId, to: to.toLowerCase(), data } });
    if (existing) return null;
    const row = await this.prisma.safeTx.create({
      data: {
        chainId: this.cfg.chainId,
        safe: this.cfg.safe.toLowerCase(),
        to: to.toLowerCase(),
        data,
        operation: 0,
        description,
        calls: [{ to: to.toLowerCase(), data, description }],
        createdBy: (this.launcher?.address ?? "matchmaker").toLowerCase(),
      },
    });
    return row.id;
  }

  // ------------------------------------------------------------------ helpers

  private async issue(events: MatchmakerEvent[], projectId: string, kind: string, message: string) {
    const key = `${projectId}:${kind}:${message}`;
    const last = this.lastIssue.get(key) ?? 0;
    if (Date.now() - last < ISSUE_REPEAT_MS) return;
    this.lastIssue.set(key, Date.now());
    events.push({ projectId, kind, message });
  }

  private read(address: Address, abi: Abi, functionName: string, args: unknown[] = []) {
    return this.pub.readContract({ address, abi, functionName, args } as never);
  }

  private async send(account: PrivateKeyAccount, address: Address, abi: Abi, functionName: string, args: unknown[]): Promise<Hex> {
    const wallet = createWalletClient({ account, transport: http(this.cfg.rpcUrl) });
    const { request } = await this.pub.simulateContract({ account, address, abi, functionName, args } as never);
    const hash = await wallet.writeContract({ ...(request as object), chain: null } as never);
    const receipt = await this.pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
    return hash;
  }
}
