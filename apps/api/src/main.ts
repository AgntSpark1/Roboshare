import "reflect-metadata";
import { createApp } from "./bootstrap.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const app = await createApp(cfg);
await app.listen(cfg.port);
console.log(`RoboShare API listening on :${cfg.port}/api/v1`);
