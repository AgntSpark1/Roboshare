import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { verifySession } from "../auth/session.js";
import { REDIS, type RedisClient } from "./redis.js";

/** Fixed one-minute windows in Redis, counted per IP and, when signed in, per wallet. */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const minute = Math.floor(Date.now() / 60_000);
    const keys = [`rl:ip:${req.ip}:${minute}`];
    const token = /(?:^|;\s*)rs_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    const session = token ? await verifySession(token, this.cfg.sessionSecret) : null;
    if (session) keys.push(`rl:wallet:${session.wallet}:${minute}`);
    const multi = this.redis.multi();
    for (const k of keys) multi.incr(k).expire(k, 120);
    const results = (await multi.exec()) ?? [];
    const counts = results.filter((_, i) => i % 2 === 0).map(([, v]) => Number(v));
    const max = Math.max(...counts);
    res.setHeader("X-RateLimit-Limit", String(this.cfg.rateLimitPerMinute));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, this.cfg.rateLimitPerMinute - max)));
    if (max > this.cfg.rateLimitPerMinute) {
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "too many requests, retry in a minute", details: {} } });
      return;
    }
    next();
  }
}
