# RoboShare — Deployment Guide

Status: **DRAFT (Phase 1).** Procedure design. Nothing has been deployed. Scripts referenced here are written in Phase 2/6. **Mainnet (chain ID 56) deployment requires explicit written approval and completion of the reviews in SECURITY_MODEL §7.**

## 1. Environments

| Env | Chain | Purpose |
|---|---|---|
| local | anvil (31337) | development, tests |
| fork | anvil forking BSC testnet or mainnet | simulation, Aave reads |
| testnet | BNB Smart Chain testnet (97) | integration, dress rehearsal |
| mainnet | BNB Smart Chain (56) | production, after approval only |

## 2. Prerequisites

- Foundry (pinned), Node 22, pnpm, Docker.
- RPC endpoints (two providers) for the target chain, supplied via env, never committed.
- Deployer key: a fresh key used only for deployment, funded with just enough BNB for gas. On mainnet, prefer a hardware wallet (`--ledger`) or deploy via a Safe.
- Safe multisigs created on the target chain for governance, guardian, operator, reviewer; signer addresses recorded in the deployment config.
- Allowlisted stablecoin address for the target chain, obtained from the issuer's official documentation and checked on BscScan; decimals read on-chain.
- BscScan API key for verification (env only).

## 3. Configuration

`contracts/script/config/<chainId>.json` (committed, contains **public addresses only**):

```json
{
  "chainId": 97,
  "governanceSafe": "0x…",
  "guardianSafe": "0x…",
  "operator": "0x…",
  "reviewerSafe": "0x…",
  "complianceRelayer": "0x…",
  "timelockDelaySeconds": 172800,
  "allowedPaymentTokens": ["0x…"]
}
```

The deploy script refuses to run if any address is zero, if `block.chainid` differs from `chainId`, or if `chainId == 56` and `CONFIRM_MAINNET=yes` is not set.

Secrets (env only): `DEPLOYER_PRIVATE_KEY` (testnet only) or `--ledger`, `BSC_RPC_URL`, `BSCSCAN_API_KEY`.

## 4. Contract deployment steps

```bash
cd contracts
forge build
forge test
# 1. Simulate (no broadcast)
forge script script/Deploy.s.sol --rpc-url $BSC_RPC_URL
# 2. Broadcast + verify (testnet)
forge script script/Deploy.s.sol --rpc-url $BSC_RPC_URL --broadcast --verify
```

The script:
1. Deploys `TimelockController` (proposer/executor = governance Safe, canceller = guardian Safe, admin = none).
2. Deploys `IdentityRegistry`, `AssetRegistry`, `AuditRegistry`, `ProjectFactory`.
3. Grants roles per SECURITY_MODEL §1.
4. Transfers `DEFAULT_ADMIN_ROLE` to the timelock and renounces deployer roles.
5. Asserts on-chain: deployer holds no roles; timelock holds admin; each role holder matches config.
6. Writes `infra/deployments/<chainId>.json` from the broadcast output (addresses, block numbers, tx hashes). This file is the only source of addresses for apps.

Per project (after a project is VERIFIED): governance schedules `ProjectFactory.deployProject(...)` through the timelock; after the delay it executes. Then the offering is configured and opened through the same path.

## 5. Application deployment

1. Provision Postgres (PITR enabled), Redis, private bucket (SSE-KMS, versioning, object lock).
2. Run migrations: `pnpm --filter db prisma migrate deploy`.
3. Deploy API and worker containers with env from the secret store. Startup validates config and refuses missing/zero addresses.
4. Start indexer from each contract's deployment block; wait for catch-up; run reconciliation.
5. Deploy web app with chain allowlist for the environment.
6. Smoke tests: health endpoint, public project list, SIWE login on testnet wallet.

## 6. Post-deployment checks

- Contracts verified on BscScan.
- Role holders match config (also visible on `/contracts`).
- Indexer lag within threshold; reconciliation clean.
- Monitoring alerts firing on a test `Paused` event in testnet.

## 7. Rollback

Contracts cannot be rolled back. For app releases: redeploy previous image; migrations must be backwards-compatible for one release. For a faulty project deployment that has not opened its offering: cancel the project and deploy a new one.
