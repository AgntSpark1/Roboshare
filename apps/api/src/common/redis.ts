import { Redis } from "ioredis";

export const REDIS = Symbol("REDIS");
export type RedisClient = Redis;
export const createRedis = (url: string) => new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
