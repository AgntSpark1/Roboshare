# RoboShare — Testing Guide

Status: **DRAFT (Phase 1).** Test plan only. No tests exist or have been run yet. When tests are written, this guide will record the exact commands and the CI jobs that run them.

## 1. Layers

| Layer | Tool | Location |
|---|---|---|
| Contract unit / integration | Foundry `forge test` | `contracts/test/unit`, `contracts/test/integration` |
| Contract fuzz | Foundry fuzzing | `contracts/test/fuzz` |
| Contract invariants | Foundry invariant tests with handlers | `contracts/test/invariant` |
| Fork tests (Aave) | `forge test --fork-url $BSC_RPC_URL` | `contracts/test/fork` |
| Static analysis | Slither, solhint (optionally Aderyn) | CI |
| Shared TS (fee math) | Vitest + fast-check; cross-checked with vectors exported from Solidity tests | `packages/shared` |
| API | Jest/Vitest + supertest against a test Postgres | `apps/api/test` |
| Worker | Vitest + anvil (reorg simulation via `anvil_reorg` / snapshot-revert) | `apps/worker/test` |
| Frontend components | Vitest + Testing Library + axe | `apps/web` |
| E2E | Playwright against anvil + API + web | `e2e/` |
| Dependencies / secrets | `pnpm audit`, OSV-Scanner, gitleaks | CI |

## 2. Required contract tests (from the master prompt)

| # | Case | Test sketch |
|---|---|---|
| 1 | Unauthorized minting | non-minter `mint` reverts; minter bound only once |
| 2 | Supply above cap | settle when sold would exceed 100 impossible; direct mint beyond cap reverts; fuzz units |
| 3 | Duplicate project registration | same projectId or assetId reverts |
| 4 | Unauthorized transfers | to ineligible, from frozen, to frozen, class not allowed, wrong state; via `transfer` and `transferFrom` |
| 5 | Expired eligibility | `vm.warp` past `expiresAt` → subscribe/transfer revert; claim still allowed unless frozen (D-13) |
| 6 | Duplicate distribution batches | second batch beyond report amount reverts; second proposal while one pending reverts |
| 7 | Incorrect allocations | table-driven vectors incl. master-prompt example (10 units, 15 %, D=10 000 → 850) and TOKENOMICS §4.4 |
| 8 | Rounding dust | fuzz D, holder sets; assert Σnet+Σfee+dust == pool, dust < holders, dust carried |
| 9 | Empty / zero batches | `amount == 0` reverts; empty holders reverts; holders summing < supply reverts |
| 10 | Invalid lifecycle transitions | exhaustive pairwise test over all states against the table |
| 11 | Unauthorized administration | every privileged function called by every non-authorized role reverts |
| 12 | Paused behaviour | each pausable function reverts when paused; unpause only by admin |
| 13 | Invalid Aave config | wrong chain ID, mismatched pool/oracle, non-allowlisted asset revert |
| 14 | Unexpected approvals/spending | contracts never pull more than computed; fee-on-transfer mock rejected; leftover allowance unused |
| 15 | Malformed/unverified reports | batch referencing SUBMITTED, REJECTED, SUPERSEDED, other project, wrong token reverts; self-approval reverts |
| 16 | Reentrancy / attack paths | malicious ERC-20 mock re-entering `claim`, `claimRefund`, `subscribe`; unsorted/duplicate holders; snapshot in future |

## 3. Invariants

From [SMART_CONTRACT_SPEC.md §12](SMART_CONTRACT_SPEC.md#12-invariants-to-be-tested-with-foundry-invariant-tests). Handlers randomly: set/revoke eligibility, subscribe, warp time, settle/fail, transfer, propose/approve/reject batches, claim, pause/unpause.

## 4. Foundry profiles (planned)

```toml
[profile.default]
fuzz = { runs = 1000 }
invariant = { runs = 64, depth = 64 }

[profile.ci]
fuzz = { runs = 10000 }
invariant = { runs = 256, depth = 128 }
```

## 5. Commands (once code exists)

```bash
cd contracts
forge build
forge test -vvv
FOUNDRY_PROFILE=ci forge test
forge coverage --report summary
forge test --gas-report --match-contract RevenueDistributor
slither . --filter-paths "lib|test"
pnpm -r test
pnpm --filter web exec playwright test
```

## 6. Rules

- A test is "passing" only after it has been executed and its output captured; phase summaries quote the actual output.
- Never skip or disable a test to get green.
- Mocks are named `Mock*`/`TestOnly*` and live under test directories.
