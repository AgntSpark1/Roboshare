# RoboShare — Threat Model

Status: **DRAFT (Phase 1).** Built from the design, not from code. To be revisited after Phase 2 (contracts), Phase 3 (backend) and before any audit. Internal threat modelling does not replace an independent security audit.

## 1. Assets to protect

| ID | Asset | Why it matters |
|---|---|---|
| AS-1 | Escrowed subscription funds (OfferingManager) | Investor money before settlement |
| AS-2 | Distribution funds (RevenueDistributor) | Investor money awaiting claims |
| AS-3 | Token supply and balances | Define who is entitled to what |
| AS-4 | Eligibility state | Gate for legal transferability |
| AS-5 | Governance and role keys | Control over all of the above |
| AS-6 | Financial report integrity | Determines how much is distributed |
| AS-7 | Private compliance data and documents | PII, legal exposure |
| AS-8 | Indexed DB state shown to users | Users act on it |
| AS-9 | Public representations (UI copy, whitepaper) | Misrepresentation liability |

## 2. Actors

External attacker; malicious or compromised investor; compromised operator staff; compromised reviewer; compromised compliance relayer key; compromised governance signer(s); malicious RPC provider; compromised KYC provider or webhook spoofing; supply-chain attacker (npm/forge dependencies); insider with DB access; phishing site impersonating RoboShare.

## 3. Trust boundaries

1. Browser ↔ API (session, CSRF, XSS).
2. Wallet ↔ contracts (signing, phishing).
3. API/worker ↔ chain RPC (data integrity, availability).
4. KYC provider ↔ API webhook.
5. API ↔ compliance schema / private storage.
6. Governance Safe ↔ timelock ↔ contracts.
7. Off-chain facts ↔ on-chain attestations.

## 4. Threats and mitigations (STRIDE-oriented)

| ID | Threat | Target | Likelihood / Impact | Mitigations | Residual |
|---|---|---|---|---|---|
| T-1 | Unauthorized mint | AS-3 | L / Critical | Mint only by immutable bound minter; cap 100 in token; invariant + fuzz tests | Bug in OfferingManager settlement |
| T-2 | Governance key compromise grants roles or force-transfers | AS-3, AS-5 | M / Critical | Safe ≥3-of-5 on hardware wallets → 48h timelock; monitoring of `RoleGranted`, `CallScheduled`; guardian can pause during delay; recovery disabled by default | Collusion of threshold signers |
| T-3 | Operator submits inflated/fake report | AS-2, AS-6 | M / High | Reviewer ≠ submitter enforced on-chain; evidence documents hashed; batch ≤ report distributable; funds pulled from treasury only on reviewer approval; external audit for annual reports | Collusion between operator and reviewer; contract cannot verify truth |
| T-4 | Duplicate distribution for same period | AS-2 | M / High | `distributedForPeriod` cap; one PROPOSED batch at a time; period uniqueness in AuditRegistry | — |
| T-5 | Double claim | AS-2 | M / High | `claimed` flag set before transfer; nonReentrant; tests | — |
| T-6 | Incorrect allocation (tier, rounding, missing holder) | AS-2 | M / High | On-chain computation; sorted unique holders; Σ balances == supply check; TS mirror for preview; fuzz Σnet+Σfee+dust == pool | Tier rule itself wrong (business risk) |
| T-7 | Transfer to ineligible wallet / bypass via `transferFrom` | AS-3, AS-4 | M / High | Checks in `_update` (covers all paths); expiry checked; state-gated | Eligibility data wrong at provider |
| T-8 | Compliance relayer key compromised: marks attacker eligible / freezes investors | AS-4 | M / High | Key in KMS; rate limit + anomaly alerts; relayer can't unfreeze (GOV only); relayer cannot move tokens; eligibility alone gives no funds | Attacker can make wallets eligible to receive transfers that holders still have to initiate |
| T-9 | Reentrancy via malicious payment token or hooks | AS-1, AS-2 | L / High | Allowlisted stablecoins only; CEI; ReentrancyGuard; balance-delta checks | Stablecoin issuer upgrade risk |
| T-10 | Fee-on-transfer / rebasing / blacklisting stablecoin | AS-1, AS-2 | M / Medium | Balance-delta check on pulls; allowlist; document issuer blacklist risk (USDT/USDC style freezes) | Issuer can freeze contract balances |
| T-11 | Excess approvals / unexpected spending | AS-1, AS-2 | L / Medium | UI requests exact-amount approvals; contracts pull exactly computed amounts; no arbitrary `transferFrom` with user-supplied `from` except `funder` restricted to reviewer call | — |
| T-12 | Lifecycle abuse (e.g. reopen offering, activate without evidence) | AS-3 | L / Medium | Transition table; terminal states; `reasonHash` required | Attestations can still be false |
| T-13 | Pause abuse / griefing by guardian | availability | L / Medium | Guardian can only pause; unpause by GOV; pause events monitored | Short DoS |
| T-14 | Stuck funds (pause forever, offering never settled) | AS-1 | L / High | `finalizeFailed` permissionless after deadline; refunds pull-based; refunds allowed while paused? → **decision: refunds blocked while paused** to stop drain during exploit, but pause has runbook max duration | Governance inaction |
| T-15 | RPC returns forged/stale data | AS-8 | M / Medium | Two providers, compare head; confirmations; reconciliation; money actions simulated against wallet's own RPC | — |
| T-16 | Chain reorg shows phantom balances/claims | AS-8 | M / Low | Confirmation depth; parent-hash check; rollback | — |
| T-17 | Webhook spoofing from fake KYC provider | AS-4 | M / High | HMAC, timestamp window, replay cache, IP allowlist if offered | Provider compromise |
| T-18 | PII leak from API/DB/logs | AS-7 | M / High | Separate schema + DB role; column encryption; no PII on-chain; log redaction; access logs; pre-signed URLs ≤ 5 min | Insider with KMS access |
| T-19 | Phishing site / malicious calldata | investors | H / High | Published contract addresses; `canTransfer` and simulation in UI; domain in SIWE; security.txt; user education | Users signing on fake sites |
| T-20 | Supply-chain compromise (npm, forge libs) | all | M / High | Pinned versions + lockfiles; `pnpm audit`/OSV scanner; Dependabot; review of lib updates; no postinstall scripts from untrusted packages | — |
| T-21 | XSS/CSRF in admin console leads to signed admin txs | AS-5 | M / High | Strict CSP; httpOnly SameSite cookies; CSRF tokens; admin money actions go to Safe proposals (signers review on Safe UI) | — |
| T-22 | Misrepresentation (projections as actuals, implied vehicle ownership) | AS-9 | M / High | `figureKind` enforced in schema/DTOs; UI labels; legal review of copy; Rights Document summary required before OFFERING | — |
| T-23 | Aave misconfiguration (wrong address, wrong chain) | data | L / Medium | Read-only; chain ID check; provider-resolved addresses compared to config; allowlist | — |
| T-24 | Cross-chain duplication of interests | AS-3 | N/A in MVP | No bridge mint path in token | Future work requires new review |
| T-25 | Lost investor keys | investor | M / Medium | Optional timelocked `forcedTransfer` with evidence (D-14) | If disabled, lost units remain lost (disclosed) |
| T-26 | Front-running of subscriptions near cap | fairness | M / Low | First-come is the stated rule; per-wallet max; disclosed | — |
| T-27 | Snapshot manipulation (buy before snapshot, sell after) | fairness | L / Low | Snapshot fixed at period end, which is in the past when proposed; transfers restricted to eligible wallets | Eligible holders can still trade around period ends (disclosed) |

## 5. Abuse cases to cover in tests

Mapped in [TESTING_GUIDE.md](TESTING_GUIDE.md): unauthorized mint, cap overflow, duplicate project, unauthorized transfer, expired eligibility, duplicate batch, wrong allocation, dust, zero batch, invalid transitions, unauthorized admin, paused behaviour, bad Aave config, unexpected approvals, malformed/unapproved reports, reentrancy with a malicious token mock.

## 6. Open items

- Choose KYC provider, then model its specific integration risks.
- Decide pause semantics for refunds and claims (current default: both blocked while paused; revisit with counsel because blocking refunds has investor-protection implications).
- Define on-call and monitoring vendor.
