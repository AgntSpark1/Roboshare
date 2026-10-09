# RoboShare — Development Roadmap

Status: **DRAFT (Phase 1).** Milestones are ordered by dependency, not by calendar. Each phase ends with a summary of what changed, what was tested (with the actual command output), what is incomplete, and the next command to run.

## M0 — Phase 1: Requirements and architecture ✅ delivered for review
- Deliverables: `docs/*` (15 documents + PHASE1_ANALYSIS.md).
- Exit: review sign-off on decisions D-1 … D-20, especially ⚠ items.

## M1 — Phase 2: Core smart contracts
Order (each with tests before moving on):
1. Foundry scaffold, pinned solc + OpenZeppelin tag, `foundry.toml` with fuzz/invariant profiles, CI job.
2. `IdentityRegistry` + TEST-ONLY mock provider helpers.
3. `AssetRegistry` with transition table.
4. `AuditRegistry`.
5. `RwaShareToken` (cap, minter binding, `_update` restrictions, checkpoints, recovery flag).
6. `OfferingManager` (escrow, settle, fail, cancel, refunds).
7. `RevenueDistributor` (+ `FeeTiers` library).
8. `ProjectFactory` (or scripted deployment, decided by bytecode size).
9. `Deploy.s.sol` for anvil and chain 97 with post-deploy role assertions.

Exit criteria:
- `forge build` clean with no warnings we haven't documented.
- `forge test` green: unit, integration, fuzz (≥ 10 000 runs in CI profile), invariants (depth ≥ 100).
- `forge coverage` report committed (target ≥ 95 % lines on core contracts).
- Slither run, findings triaged in `docs/security/slither-triage.md`.
- Gas report for `proposeBatch` with 100 holders.

## M2 — Phase 3: Backend
1. Monorepo scaffold (pnpm, Turborepo), `packages/shared` (zod schemas, fee math TS mirror with property tests against Solidity vectors), `packages/contracts-abi`.
2. Prisma schema + migrations; DB roles; compliance schema.
3. NestJS API: auth (SIWE), public, investor, admin modules, guards, DTOs.
4. Worker: indexer with reorg handling, report pipeline, reconciliation, compliance relayer (TEST-ONLY mock provider in dev).
5. Docker Compose: Postgres, Redis, MinIO, anvil.

Exit: API e2e tests (supertest) green; indexer passes a scripted anvil reorg test; reconciliation detects an injected mismatch.

## M3 — Phase 4: Frontend
1. Design system (Tailwind + shadcn/ui), layout, accessibility baseline.
2. Public pages: landing, overview, listings, project detail, architecture, how it works, risk disclosures, docs, whitepaper, FAQ.
3. Investor dashboard: eligibility, holdings, allocation, positions, transactions, distributions, actual vs projected, verification links.
4. Admin: projects, documents, offerings, compliance, reports, distributions, roles, audit history, emergency controls (Safe proposals).

Exit: component tests (Vitest + Testing Library) and Playwright E2E for subscribe → settle → report → batch → claim on anvil; axe accessibility checks pass; no button without a handler.

## M4 — Phase 5: Aave read-only adapter
1. Collect Aave V3 BNB Smart Chain addresses from official sources (Aave address book, governance proposals) and cross-check on-chain (`PoolAddressesProvider.getPool()`, `getPriceOracle()`, data provider reserve list).
2. Worker reader + optional `AaveReader.sol`; chain ID and address checks; allowlist.
3. UI panel showing verified market data with source block and addresses.

Exit: fork tests against BSC mainnet state (`forge test --fork-url`) pass; invalid-config tests pass. Transactional features remain out of scope pending explicit review.

## M5 — Phase 6: Security and testnet deployment
1. Full test suite, coverage, Slither/Aderyn, `pnpm audit`, OSV-Scanner, gitleaks.
2. Deployment simulation on anvil and a BSC testnet fork; then deploy to chain 97 with Safe + timelock on testnet.
3. Verify contracts on BscScan testnet.
4. Testnet dress rehearsal of the full lifecycle, including pause, rejected report, failed offering with refunds.
5. Internal security review report.

Exit: testnet addresses recorded in `infra/deployments/97.json` from real deployment output; review report published.

## M6 — Pre-mainnet (outside engineering control)
- Independent audit; legal sign-off on Rights Document, offering terms, disclosures; KYC provider contracted; operational readiness (on-call, runbooks drilled).
- Mainnet deployment only on explicit written approval.

## Later (not scheduled)
- Transactional Aave features (separate review).
- Cross-chain (separate design + audit).
- Secondary market / transfer agent integration.
- Multi-language UI (e.g. Chinese/English).
