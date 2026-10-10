import { PrismaClient } from "@roboshare/db";
import { Redis } from "ioredis";
import { createPublicClient, http } from "viem";
import { AAVE_BNB_ALLOWLIST, AAVE_V3_BNB } from "@roboshare/shared";
import { readAaveMarkets, saveAaveSnapshot } from "./aave.js";
import { loadConfig } from "./config.js";
import { Indexer } from "./indexer.js";
import { reconcile } from "./reconcile.js";

const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 3000);
const RECONCILE_EVERY = Number(process.env.RECONCILE_EVERY_TICKS ?? 100);
const LOCK_KEY = "roboshare:indexer:leader";
const AAVE_EVERY_MS = Number(process.env.AAVE_POLL_MS ?? 300_000);

/** Optional: read-only Aave V3 market data from BSC mainnet (AAVE_RPC_URL), independent of CHAIN_ID. */
function startAaveReader(prisma: PrismaClient) {
  const rpc = process.env.AAVE_RPC_URL;
  if (!rpc) return;
  const client = createPublicClient({ transport: http(rpc), cacheTime: 0 });
  const run = async () => {
    try {
      const s = await readAaveMarkets(client, AAVE_V3_BNB, AAVE_BNB_ALLOWLIST);
      await saveAaveSnapshot(prisma, s);
      console.log(JSON.stringify({ msg: "aave snapshot", block: s.blockNumber.toString(), reserves: s.reserves.length }));
    } catch (err) {
      // A failed check means no new data is published; the API keeps serving the last verified read.
      console.error(JSON.stringify({ msg: "aave read failed", error: String(err) }));
    }
  };
  void run();
  setInterval(run, AAVE_EVERY_MS);
}

async function main() {
  const cfg = loadConfig();
  const prisma = new PrismaClient();
  const client = createPublicClient({ transport: http(cfg.rpcUrl), cacheTime: 0 });
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const id = `${process.pid}-${Date.now()}`;
  const indexer = new Indexer(prisma, client, cfg);
  await indexer.init();
  startAaveReader(prisma);

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
