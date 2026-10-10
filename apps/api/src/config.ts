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
  siweDomain: z.string().min(1),
  kycWebhookSecret: z.string().min(32).optional(),
  // Contract addresses come from the deployment output. Prepare endpoints refuse to run without them.
  assetRegistry: optionalAddress,
  auditRegistry: optionalAddress,
  paymentToken: optionalAddress,
});

export type AppConfig = z.infer<typeof configSchema>;
export const APP_CONFIG = Symbol("APP_CONFIG");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    chainId: env.CHAIN_ID,
    sessionSecret: env.SESSION_SECRET,
    siweDomain: env.SIWE_DOMAIN,
    kycWebhookSecret: env.KYC_WEBHOOK_SECRET || undefined,
    assetRegistry: env.ASSET_REGISTRY,
    auditRegistry: env.AUDIT_REGISTRY,
    paymentToken: env.PAYMENT_TOKEN,
  });
}
