import { getAddress, isAddress } from "viem";
import { z } from "zod";

const optionalAddress = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    if (!isAddress(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid address" });
      return z.NEVER;
    }
    return getAddress(v);
  });

export const configSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  port: z.coerce.number().int().default(4000),
  databaseUrl: z.string().min(1),
  redisUrl: z.string().min(1),
  chainId: z.coerce.number().int().positive(),
  sessionSecret: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  /** Host (or comma-separated hosts) allowed in SIWE messages, e.g. the investor DApp and the admin console. */
  siweDomain: z.string().min(1),
  /** 32-byte hex key that encrypts staff TOTP secrets. Without it staff step-up is not enforced (dev only). */
  totpEncKey: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  rateLimitPerMinute: z.coerce.number().int().positive().default(120),
  // Contract addresses come from the deployment output. Prepare endpoints refuse to run without them.
  assetRegistry: optionalAddress,
  auditRegistry: optionalAddress,
  paymentToken: optionalAddress,
  /** The 2/3 governance Safe; it holds admin on every contract directly (no timelock). */
  safe: optionalAddress,
}).refine((c) => c.nodeEnv !== "production" || !!c.totpEncKey, { message: "TOTP_ENC_KEY is required in production", path: ["totpEncKey"] });

export type AppConfig = z.infer<typeof configSchema>;
export const APP_CONFIG = Symbol("APP_CONFIG");

export function siweDomains(cfg: Pick<AppConfig, "siweDomain">): string[] {
  return cfg.siweDomain.split(",").map((d) => d.trim()).filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    chainId: env.CHAIN_ID,
    sessionSecret: env.SESSION_SECRET,
    siweDomain: env.SIWE_DOMAIN,
    totpEncKey: env.TOTP_ENC_KEY || undefined,
    rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
    safe: env.SAFE,
    assetRegistry: env.ASSET_REGISTRY,
    auditRegistry: env.AUDIT_REGISTRY,
    paymentToken: env.PAYMENT_TOKEN,
  });
}
