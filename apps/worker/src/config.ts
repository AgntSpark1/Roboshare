import { getAddress, isAddress } from "viem";
import { z } from "zod";

const address = z
  .string()
  .refine((v) => isAddress(v), "must be a valid address")
  .transform((v) => getAddress(v));

export const indexerConfigSchema = z.object({
  chainId: z.coerce.number().int().positive(),
  rpcUrl: z.string().url(),
  assetRegistry: address,
  auditRegistry: address,
  identityRegistry: address,
  subscriptionRouter: address,
  projectFactory: address,
  /** Optional until the referral programme is deployed (REFERRAL_DESIGN.md). */
  referralRewards: address.optional(),
  startBlock: z.coerce.bigint().nonnegative(),
  confirmations: z.coerce.number().int().nonnegative().default(15),
  batchSize: z.coerce.number().int().positive().default(2000),
});

export type IndexerConfig = z.infer<typeof indexerConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  return indexerConfigSchema.parse({
    chainId: env.CHAIN_ID,
    rpcUrl: env.RPC_URL,
    assetRegistry: env.ASSET_REGISTRY,
    auditRegistry: env.AUDIT_REGISTRY,
    identityRegistry: env.IDENTITY_REGISTRY,
    subscriptionRouter: env.SUBSCRIPTION_ROUTER,
    projectFactory: env.PROJECT_FACTORY,
    referralRewards: env.REFERRAL_REWARDS || undefined,
    startBlock: env.START_BLOCK,
    confirmations: env.CONFIRMATIONS,
    batchSize: env.INDEXER_BATCH_SIZE,
  });
}
