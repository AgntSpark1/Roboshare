import { PrismaClient } from "@roboshare/db";
import { Redis } from "ioredis";
import { createPublicClient, http } from "viem";
import { AAVE_BNB_ALLOWLIST, AAVE_V3_BNB } from "@roboshare/shared";
import { readAaveMarkets, saveAaveSnapshot } from "./aave.js";
import { loadConfig } from "./config.js";
import { Indexer } from "./indexer.js";
import { reconcile } from "./reconcile.js";
import { autoSettle, settleSender } from "./settler.js";
import { Autopilot, dailyOperatingTotals, loadAutopilotConfig } from "./autopilot.js";
import { Matchmaker, loadMatchmakerConfig } from "./matchmaker.js";
import { loadCityConfig, runCityRewards } from "./city.js";
import { loadDemoDailyConfig, runDemoDaily } from "./demoDaily.js";

const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 3000);
const RECONCILE_EVERY = Number(process.env.RECONCILE_EVERY_TICKS ?? 100);
const LOCK_KEY = "roboshare:indexer:leader";
const SETTLE_EVERY_MS = Number(process.env.SETTLE_POLL_MS ?? 15_000);
const AUTOPILOT_EVERY_MS = Number(process.env.AUTOPILOT_EVERY_MS ?? 60_000);
const MATCHMAKER_EVERY_MS = Number(process.env.MATCHMAKER_EVERY_MS ?? 30_000);
const CITY_EVERY_MS = Number(process.env.CITY_REWARD_EVERY_MS ?? 3_600_000);
const DEMO_DAILY_EVERY_MS = Number(process.env.DEMO_DAILY_EVERY_MS ?? 600_000);
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

  // Optional: a gas-only wallet with no role that settles sold-out offerings (settle() is permissionless).
  const settlerKey = process.env.SETTLER_PRIVATE_KEY as `0x${string}` | undefined;
  const settler = settlerKey ? settleSender(client, cfg.rpcUrl, settlerKey) : undefined;
  if (settler) console.log(JSON.stringify({ msg: "auto-settle enabled", account: settler.account }));
  let settling = false;
  let lastSettle = 0;

  // Optional: monthly profit distribution without a person (autopilot.ts). Two minimal-role keys, granted by the Safe.
  const apCfg = loadAutopilotConfig();
  const autopilot = apCfg ? new Autopilot(prisma, client, apCfg, dailyOperatingTotals(prisma)) : undefined;
  if (autopilot) console.log(JSON.stringify({ msg: "autopilot enabled", submitter: autopilot.submitter.address, approver: autopilot.approver.address }));
  let piloting = false;
  let lastPilot = 0;

  // Optional: robot matchmaking (matchmaker.ts). Lists the next vehicle and has the disclosed platform wallet buy
  // unsold units near the deadline; each part is switched on in the console.
  const mmCfg = loadMatchmakerConfig();
  const matchmaker = mmCfg ? new Matchmaker(prisma, client, mmCfg) : undefined;
  if (matchmaker) {
    await matchmaker.init();
    console.log(JSON.stringify({ msg: "matchmaker ready", launcher: matchmaker.launcher?.address, verifier: matchmaker.verifier?.address, backstop: matchmaker.backstop?.address }));
  }
  let matching = false;
  let lastMatch = 0;

  // Optional: the city reward (city.ts), counted on the monthly settlement day. Database only, no keys.
  const cityCfg = loadCityConfig();
  if (cityCfg) console.log(JSON.stringify({ msg: "city reward enabled", start: cityCfg.start.toISOString() }));
  let lastCity = 0;

  // Optional, testnets only: simulated daily operating figures for running vehicles (demoDaily.ts).
  const demoCfg = loadDemoDailyConfig();
  if (demoCfg) console.log(JSON.stringify({ msg: "demo daily operations enabled" }));
  let lastDemo = 0;

  let ticks = 0;
  for (;;) {
    // Only one active indexer: hold a short Redis lease and renew it every loop.
    const got = await redis.set(LOCK_KEY, id, "PX", POLL_MS * 5, "NX");
    const mine = got === "OK" || (await redis.get(LOCK_KEY)) === id;
    if (mine) {
      await redis.pexpire(LOCK_KEY, POLL_MS * 5);
      if (settler && !settling && Date.now() - lastSettle >= SETTLE_EVERY_MS) {
        // Runs beside the indexer so waiting for a receipt never stalls indexing.
        settling = true;
        lastSettle = Date.now();
        void autoSettle(prisma, client, settler.send)
          .catch((err) => console.error(JSON.stringify({ msg: "auto-settle error", error: String(err) })))
          .finally(() => { settling = false; });
      }
      if (autopilot && !piloting && Date.now() - lastPilot >= AUTOPILOT_EVERY_MS) {
        piloting = true;
        lastPilot = Date.now();
        void autopilot
          .tick()
          .then((ev) => ev.forEach((e) => console.log(JSON.stringify({ msg: "autopilot", ...e }))))
          .catch((err) => console.error(JSON.stringify({ msg: "autopilot error", error: String(err) })))
          .finally(() => { piloting = false; });
      }
      if (matchmaker && !matching && Date.now() - lastMatch >= MATCHMAKER_EVERY_MS) {
        matching = true;
        lastMatch = Date.now();
        void matchmaker
          .tick()
          .then((ev) => ev.forEach((e) => console.log(JSON.stringify({ msg: "matchmaker", ...e }))))
          .catch((err) => console.error(JSON.stringify({ msg: "matchmaker error", error: String(err) })))
          .finally(() => { matching = false; });
      }
      if (cityCfg && Date.now() - lastCity >= CITY_EVERY_MS) {
        lastCity = Date.now();
        await runCityRewards(prisma, cityCfg)
          .then((r) => r.counted && console.log(JSON.stringify({ msg: "city reward", ...r })))
          .catch((err) => console.error(JSON.stringify({ msg: "city reward error", error: String(err) })));
      }
      if (demoCfg && Date.now() - lastDemo >= DEMO_DAILY_EVERY_MS) {
        lastDemo = Date.now();
        await runDemoDaily(prisma, demoCfg)
          .then((r) => r.added && console.log(JSON.stringify({ msg: "demo daily operations", ...r })))
          .catch((err) => console.error(JSON.stringify({ msg: "demo daily operations error", error: String(err) })));
      }
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
