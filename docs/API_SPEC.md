# RoboShare — API Specification

Status: **DRAFT (Phase 1).** REST over HTTPS, JSON. An OpenAPI 3.1 document will be generated from NestJS decorators in Phase 3 and becomes authoritative.

## 1. Conventions

- Base path `/api/v1`. Amounts are strings of integer base units with the payment token's `decimals` alongside.
- Errors: `{ "error": { "code": "NOT_ELIGIBLE", "message": "...", "details": {} } }`.
- Pagination: cursor based, `?cursor=&limit=` (max 100).
- Every response that includes a figure includes `figureKind: "ACTUAL" | "PROJECTED"`.
- Every chain-derived object includes `chain: { chainId, txHash, blockNumber, confirmed }`.
- Idempotency: mutating admin endpoints accept `Idempotency-Key`.
- Rate limits per IP and per wallet (Redis).

## 2. Visibility tiers

| Tier | Auth | Guard |
|---|---|---|
| `public` | none | — |
| `investor` | SIWE session cookie | `InvestorGuard` (wallet linked to user; project-level docs also require current eligibility) |
| `admin:<role>` | SIWE + staff TOTP + on-chain role mirror | `RoleGuard(OPERATOR / REVIEWER / COMPLIANCE / GOV_VIEW)` |

Response DTOs are per tier; a public DTO type has no restricted fields at all.

## 3. Auth

| Method | Path | Tier | Description |
|---|---|---|---|
| GET | `/auth/nonce?address=` | public | SIWE nonce (Redis, 5 min TTL) |
| POST | `/auth/verify` | public | body `{message, signature}`; validates domain, chainId, nonce; sets httpOnly session cookie |
| POST | `/auth/logout` | investor | revoke session |
| GET | `/auth/me` | investor | user, linked wallets, eligibility summary (status + expiry only) |
| POST | `/auth/staff/totp` | investor | step-up for staff |

## 4. Public

| Method | Path | Description |
|---|---|---|
| GET | `/projects` | list: id, title, state, make/model, supply issued/authorized, offering status |
| GET | `/projects/:id` | detail: legal rights summary, issuer name, state history, supply, offering terms summary, fee tiers, risk factors, public document list with hashes |
| GET | `/projects/:id/financials` | approved report summaries only: period, revenue, expenses, reserves, distributable, assurance level, report hash, record tx |
| GET | `/projects/:id/distributions` | batch totals: period, pool, total net, total fee, dust, snapshot block, tx hashes |
| GET | `/projects/:id/documents/:docId/versions/:v/verify?hash=` | compare a hash against the anchored record |
| GET | `/contracts` | deployed contract addresses per chain, explorer verification status, role holders |
| GET | `/aave/markets` | Phase 5: verified market metadata and allowlisted reserve data, with source addresses and read block |
| GET | `/content/*` | whitepaper, FAQ, risk disclosures (versioned) |
| GET | `/health` | liveness/readiness, indexer lag |

## 5. Investor

| Method | Path | Description |
|---|---|---|
| GET | `/me/eligibility` | per wallet: status, class code, expiry, on-chain status, mismatch flag |
| POST | `/me/eligibility/start` | starts provider flow; returns provider session URL (provider TBD). In dev: TEST-ONLY mock |
| POST | `/me/risk-acknowledgement` | records acknowledgement of a disclosure version |
| GET | `/me/portfolio` | holdings per project, allocation %, cost basis from settled subscriptions |
| GET | `/me/subscriptions` | status per offering incl. refund availability |
| GET | `/me/transactions` | mints, transfers, refunds, claims with tx hashes |
| GET | `/me/distributions` | allocations: batch, units at snapshot, gross, fee tier, fee, net, claimed, claim tx |
| GET | `/projects/:id/documents/:docId/download` | pre-signed URL for INVESTOR docs (eligible wallet required), logged |
| GET | `/projects/:id/reports/:reportId` | full approved report with line items |
| POST | `/tx/pending` | register a wallet-submitted tx hash for UI tracking |

Writes that move value (subscribe, claim, refund, transfer) are signed by the investor's wallet directly against contracts. The API never holds investor keys or custody.

## 6. Admin

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/admin/projects` | OPERATOR | create draft (DB) + prepare `registerProject` tx |
| PATCH | `/admin/projects/:id` | OPERATOR | edit draft fields |
| POST | `/admin/projects/:id/documents` | OPERATOR | upload version → hash → prepare `submitRecord` |
| POST | `/admin/projects/:id/transition` | REVIEWER / GOV_VIEW | prepare transition tx or Safe proposal |
| POST | `/admin/projects/:id/offering` | GOV_VIEW | validate config (reads stablecoin decimals on-chain), prepare Safe proposal for `configure` + `open` |
| POST | `/admin/offerings/:id/settle` | OPERATOR | pre-checks eligibility of all subscribers; prepare `settle` |
| POST | `/admin/offerings/:id/exclude` | GOV_VIEW | prepare Safe proposal for `excludeSubscriber` |
| POST | `/admin/reports` | OPERATOR | submit report JSON + attachments; zod-validated; returns canonical hash |
| POST | `/admin/reports/:id/review` | REVIEWER | approve/reject (must differ from submitter) and prepare on-chain tx |
| POST | `/admin/distributions/preview` | OPERATOR | input reportId, amount, snapshotBlock → holder list from snapshot + TS allocation preview |
| POST | `/admin/distributions` | OPERATOR | prepare `proposeBatch` |
| POST | `/admin/distributions/:id/approve` | REVIEWER | prepare `approveBatch` (Safe proposal) |
| GET | `/admin/compliance/wallets` | COMPLIANCE | wallet status list (codes only) |
| POST | `/admin/compliance/wallets/:addr/freeze` | COMPLIANCE | enqueue relayer tx |
| GET | `/admin/roles` | any admin | on-chain role holders per contract |
| GET | `/admin/audit-log` | any admin | `admin_action` + chain events |
| POST | `/admin/pause` | (Guardian) | prepares Safe proposal; never sent by server |
| GET | `/admin/reconciliation` | any admin | latest runs and open issues |
| POST | `/admin/reconciliation/run` | OPERATOR | trigger run |
| GET | `/admin/exports/:kind?projectId=&format=csv` | any admin | project, holdings, distributions, reports |

"Prepare" means the API returns unsigned calldata (for a staff wallet) or creates a Safe transaction proposal; it does not sign with a server key. The only server-side signer is the rate-limited compliance relayer.

## 7. Webhooks

| Path | Source | Security |
|---|---|---|
| POST `/webhooks/kyc/:provider` | KYC provider | HMAC signature verification, timestamp tolerance, replay cache; payload stored only in `compliance` schema |

## 8. Error codes (indicative)

`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_ELIGIBLE`, `ELIGIBILITY_EXPIRED`, `WALLET_FROZEN`, `PROJECT_STATE_INVALID`, `OFFERING_CLOSED`, `CAP_EXCEEDED`, `REPORT_INVALID`, `SELF_REVIEW_FORBIDDEN`, `PERIOD_ALREADY_APPROVED`, `AMOUNT_EXCEEDS_REPORT`, `RECONCILIATION_BLOCKED`, `CHAIN_UNAVAILABLE`.
