import type { PrismaClient } from "@roboshare/db";
import { auditRegistryAbi } from "@roboshare/shared";
import { decodeEventLog, type Hex, type Log, type PublicClient } from "viem";
import type { IndexerConfig } from "./config.js";
import { CONTRACT_KINDS, type ContractKind } from "./contracts.js";
import { toJson } from "./json.js";
import { applyEvent, rebuildProjections, type StoredEvent } from "./projector.js";

export interface TickResult {
  fromBlock: bigint;
  toBlock: bigint;
  events: number;
  reorgedTo?: bigint;
}

interface Watched {
  kind: ContractKind;
  projectId: string | null;
}

const lc = (a: string) => a.toLowerCase();

/**
 * Polls confirmed blocks, stores decoded events in chain.event and updates read models in the
 * same database transaction. Detects reorgs by re-checking the cursor block hash; on a mismatch it
 * rewinds to the last stored block that is still canonical and rebuilds projections from events.
 */
export class Indexer {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: PublicClient,
    private readonly cfg: IndexerConfig,
  ) {}

  /** Registers the singleton contracts from config. Idempotent. */
  async init(): Promise<void> {
    const singletons: [ContractKind, string][] = [
      ["IDENTITY_REGISTRY", this.cfg.identityRegistry],
      ["ASSET_REGISTRY", this.cfg.assetRegistry],
      ["AUDIT_REGISTRY", this.cfg.auditRegistry],
      ["SUBSCRIPTION_ROUTER", this.cfg.subscriptionRouter],
      ["PROJECT_FACTORY", this.cfg.projectFactory],
    ];
    if (this.cfg.referralRewards) singletons.push(["REFERRAL_REWARDS", this.cfg.referralRewards]);
    const chainId = await this.client.getChainId();
    if (chainId !== this.cfg.chainId) {
      throw new Error(`RPC chainId ${chainId} does not match CHAIN_ID ${this.cfg.chainId}`);
    }
    for (const [kind, address] of singletons) {
      if ((await this.client.getCode({ address: address as Hex })) === undefined) {
        throw new Error(`${kind} at ${address} has no code on chain ${chainId}`);
      }
      await this.prisma.contractDeployment.upsert({
        where: { chainId_address: { chainId, address: lc(address) } },
        create: { chainId, address: lc(address), kind, deployedBlock: this.cfg.startBlock },
        update: {},
      });
    }
  }

  async lag(): Promise<bigint | null> {
    const cursor = await this.prisma.indexerCursor.findUnique({ where: { chainId: this.cfg.chainId } });
    if (!cursor) return null;
    return (await this.client.getBlockNumber()) - cursor.lastBlock;
  }

  /** Processes at most one batch of blocks. Returns null when there is nothing confirmed to index. */
  async tick(): Promise<TickResult | null> {
    const chainId = this.cfg.chainId;
    let reorgedTo: bigint | undefined;
    let cursor = await this.prisma.indexerCursor.findUnique({ where: { chainId } });
    if (cursor) {
      const onChain = await this.client.getBlock({ blockNumber: cursor.lastBlock }).catch(() => null);
      if (!onChain || onChain.hash !== cursor.lastHash) {
        reorgedTo = await this.rewind(cursor.lastBlock);
        cursor = await this.prisma.indexerCursor.findUnique({ where: { chainId } });
      }
    }

    const head = await this.client.getBlockNumber();
    const confirmedHead = head - BigInt(this.cfg.confirmations);
    const fromBlock = cursor ? cursor.lastBlock + 1n : this.cfg.startBlock;
    if (fromBlock > confirmedHead) return reorgedTo === undefined ? null : { fromBlock, toBlock: fromBlock - 1n, events: 0, reorgedTo };
    const toBlock = confirmedHead < fromBlock + BigInt(this.cfg.batchSize) - 1n ? confirmedHead : fromBlock + BigInt(this.cfg.batchSize) - 1n;

    const watched = await this.watched();
    const singletons = [...watched].filter(([, w]) => w.projectId === null).map(([a]) => a);
    const logs: Log[] = await this.client.getLogs({ address: singletons as Hex[], fromBlock, toBlock });

    // Project contracts are created inside the range by ProjectFactory.deployProject, so register
    // the links found in this range before fetching their logs.
    const decoded = logs.map((l) => this.decode(l, watched));
    for (const d of decoded) {
      if (d?.name === "ProjectContractsLinked") {
        watched.set(lc(d.args.token), { kind: "TOKEN", projectId: d.args.projectId });
        watched.set(lc(d.args.offering), { kind: "OFFERING", projectId: d.args.projectId });
        watched.set(lc(d.args.distributor), { kind: "DISTRIBUTOR", projectId: d.args.projectId });
      }
    }
    const projectAddrs = [...watched].filter(([, w]) => w.projectId !== null).map(([a]) => a);
    if (projectAddrs.length > 0) {
      const projectLogs = await this.client.getLogs({ address: projectAddrs as Hex[], fromBlock, toBlock });
      for (const l of projectLogs) {
        logs.push(l);
        decoded.push(this.decode(l, watched));
      }
    }

    const items = logs
      .map((log, i) => ({ log, ev: decoded[i] }))
      .filter((x): x is { log: Log; ev: NonNullable<typeof x.ev> } => x.ev !== null)
      .sort((x, y) =>
        x.log.blockNumber === y.log.blockNumber
          ? x.log.logIndex! - y.log.logIndex!
          : x.log.blockNumber! < y.log.blockNumber! ? -1 : 1,
      );

    // Enrich events whose payload is not enough for the read model, reading state at that block.
    for (const { log, ev } of items) {
      if (ev.name === "RecordSubmitted") {
        const r = await this.client.readContract({
          address: log.address,
          abi: auditRegistryAbi,
          functionName: "getRecord",
          args: [ev.args.recordId as Hex],
          blockNumber: log.blockNumber!,
        });
        ev.args.record = toJson(r);
      }
    }

    const blockNumbers = new Set<bigint>(items.map((x) => x.log.blockNumber!));
    blockNumbers.add(toBlock);
    const blocks = new Map<bigint, { hash: string; timestamp: bigint }>();
    for (const n of blockNumbers) {
      const b = await this.client.getBlock({ blockNumber: n });
      blocks.set(n, { hash: b.hash, timestamp: b.timestamp });
    }
    // A log whose block hash differs from the block we just read means the range is reorging under us.
    for (const { log } of items) {
      if (blocks.get(log.blockNumber!)!.hash !== log.blockHash) {
        throw new Error(`block ${log.blockNumber} changed while indexing; retry`);
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const [number, b] of blocks) {
          await tx.chainBlock.upsert({
            where: { chainId_number: { chainId, number } },
            create: { chainId, number, hash: b.hash, timestamp: new Date(Number(b.timestamp) * 1000) },
            update: { hash: b.hash, timestamp: new Date(Number(b.timestamp) * 1000) },
          });
        }
        for (const { log, ev } of items) {
          const row = await tx.chainEvent.create({
            data: {
              chainId,
              blockNumber: log.blockNumber!,
              blockHash: log.blockHash!,
              txHash: log.transactionHash!,
              logIndex: log.logIndex!,
              address: lc(log.address),
              name: ev.name,
              args: ev.args as object,
            },
          });
          const stored: StoredEvent = { ...row, args: ev.args, kind: ev.kind, projectId: ev.projectId };
          await applyEvent(tx, stored);
        }
        const end = blocks.get(toBlock)!;
        await tx.indexerCursor.upsert({
          where: { chainId },
          create: { chainId, lastBlock: toBlock, lastHash: end.hash },
          update: { lastBlock: toBlock, lastHash: end.hash },
        });
      },
      { timeout: 60_000 },
    );
    return { fromBlock, toBlock, events: items.length, reorgedTo };
  }

  /** Runs tick() until caught up with the confirmed head. */
  async catchUp(): Promise<number> {
    let events = 0;
    for (;;) {
      const r = await this.tick();
      if (!r) return events;
      events += r.events;
      if (r.toBlock < r.fromBlock) return events;
    }
  }

  private async rewind(fromBlock: bigint): Promise<bigint> {
    const chainId = this.cfg.chainId;
    const stored = await this.prisma.chainBlock.findMany({
      where: { chainId, number: { lte: fromBlock } },
      orderBy: { number: "desc" },
    });
    let ancestor = this.cfg.startBlock - 1n;
    let ancestorHash = "";
    for (const b of stored) {
      const onChain = await this.client.getBlock({ blockNumber: b.number }).catch(() => null);
      if (onChain && onChain.hash === b.hash) {
        ancestor = b.number;
        ancestorHash = b.hash;
        break;
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.chainEvent.deleteMany({ where: { chainId, blockNumber: { gt: ancestor } } });
      await tx.chainBlock.deleteMany({ where: { chainId, number: { gt: ancestor } } });
      if (ancestorHash) {
        await tx.indexerCursor.update({ where: { chainId }, data: { lastBlock: ancestor, lastHash: ancestorHash } });
      } else {
        await tx.indexerCursor.delete({ where: { chainId } });
      }
    });
    await rebuildProjections(this.prisma, chainId);
    return ancestor;
  }

  private async watched(): Promise<Map<string, Watched>> {
    const rows = await this.prisma.contractDeployment.findMany({ where: { chainId: this.cfg.chainId } });
    return new Map(rows.map((r) => [r.address, { kind: r.kind as ContractKind, projectId: r.projectId }]));
  }

  private decode(log: Log, watched: Map<string, Watched>) {
    const w = watched.get(lc(log.address));
    if (!w) return null;
    try {
      const d = decodeEventLog({ abi: CONTRACT_KINDS[w.kind], data: log.data, topics: log.topics });
      return { name: d.eventName as string, args: toJson(d.args ?? {}) as Record<string, any>, kind: w.kind, projectId: w.projectId };
    } catch {
      return null; // event not in our ABI (should not happen for our own contracts)
    }
  }
}
