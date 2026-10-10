import { CallHandler, ExecutionContext, Inject, Injectable, type NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import { from, of, type Observable } from "rxjs";
import { mergeMap, tap } from "rxjs/operators";
import type { AuthedRequest } from "../auth/guards.js";
import { ApiError } from "./errors.js";
import { REDIS, type RedisClient } from "./redis.js";

const TTL_SECONDS = 24 * 60 * 60;

/**
 * Admin mutations accept an Idempotency-Key header. A repeated key from the same user and route
 * returns the first response instead of running the action again.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header("idempotency-key");
    if (req.method !== "POST" || !key) return next.handle();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new ApiError(400, "VALIDATION_FAILED", "invalid Idempotency-Key");
    const redisKey = `idem:${req.session?.userId}:${req.method}:${req.path}:${key}`;
    return from(this.redis.set(`${redisKey}:lock`, "1", "EX", 60, "NX")).pipe(
      mergeMap(async (locked) => {
        const cached = await this.redis.get(redisKey);
        if (cached) {
          const { status, body } = JSON.parse(cached) as { status: number; body: unknown };
          res.status(status);
          res.setHeader("Idempotent-Replay", "true");
          return { replay: true as const, body };
        }
        if (locked !== "OK") throw new ApiError(409, "CONFLICT", "a request with this Idempotency-Key is in progress");
        return { replay: false as const };
      }),
      mergeMap((r) =>
        r.replay
          ? of(r.body)
          : next.handle().pipe(
              tap(async (body) => {
                await this.redis.set(redisKey, JSON.stringify({ status: res.statusCode, body }), "EX", TTL_SECONDS);
                await this.redis.del(`${redisKey}:lock`);
              }),
            ),
      ),
    );
  }
}
