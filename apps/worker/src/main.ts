import { PrismaClient } from "@roboshare/db";
import { Redis } from "ioredis";
import { createPublicClient, http } from "viem";
import { loadConfig } from "./config.js";
import { Indexer } from "./indexer.js";
import { reconcile } from "./reconcile.js";

const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 3000);
const RECONCILE_EVERY = Number(process.env.RECONCILE_EVERY_TICKS ?? 100);
const LOCK_KEY = "roboshare:indexer:leader";

async function main() {
  const cfg = loadConfig();
  const prisma = new PrismaClient();
  const client = createPublicClient({ transport: http(cfg.rpcUrl), cacheTime: 0 });
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const id = `${process.pid}-${Date.now()}`;
  const indexer = new Indexer(prisma, client, cfg);
  await indexer.init();

  let ticks = 0;
  for (;;) {
    // Only one active indexer: hold a short Redis lease and renew it every loop.
    const got = await redis.set(LOCK_KEY, id, "PX", POLL_MS * 5, "NX");
    const mine = got === "OK" || (await redis.get(LOCK_KEY)) === id;
    if (mine) {
      await redis.pexpire(LOCK_KEY, POLL_MS * 5);
      try {
        const r = await indexer.tick();
        if (r) console.log(JSON.stringify({ msg: "indexed", ...r, fromBlock: `${r.fromBlock}`, toBlock: `${r.toBlock}`, reorgedTo: r.reorgedTo?.toString() }));
        if (++ticks % RECONCILE_EVERY === 0) {
          const run = await reconcile(prisma, client, cfg.chainId);
          console.log(JSON.stringify({ msg: "reconciled", ok: run.ok, issues: run.issues.length }));
        }
        if (r && r.toBlock >= r.fromBlock) continue; // more to catch up
      } catch (err) {
        console.error(JSON.stringify({ msg: "indexer error", error: String(err) }));
      }
    }
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
