import {
  assetRegistryAbi,
  auditRegistryAbi,
  identityRegistryAbi,
  offeringManagerAbi,
  projectFactoryAbi,
  referralRewardsAbi,
  revenueDistributorAbi,
  rwaShareTokenAbi,
  subscriptionRouterAbi,
} from "@roboshare/shared";
import type { Abi } from "viem";

export const CONTRACT_KINDS = {
  IDENTITY_REGISTRY: identityRegistryAbi,
  ASSET_REGISTRY: assetRegistryAbi,
  AUDIT_REGISTRY: auditRegistryAbi,
  SUBSCRIPTION_ROUTER: subscriptionRouterAbi,
  PROJECT_FACTORY: projectFactoryAbi,
  REFERRAL_REWARDS: referralRewardsAbi,
  TOKEN: rwaShareTokenAbi,
  OFFERING: offeringManagerAbi,
  DISTRIBUTOR: revenueDistributorAbi,
} as const satisfies Record<string, Abi>;

export type ContractKind = keyof typeof CONTRACT_KINDS;
export const PROJECT_CONTRACT_KINDS: readonly ContractKind[] = ["TOKEN", "OFFERING", "DISTRIBUTOR"];
