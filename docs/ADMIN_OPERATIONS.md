# RoboShare — Admin Operations Runbook

Status: **DRAFT (Phase 1).** Procedures for the intended system. Screens and scripts referenced here do not exist yet.

Roles below refer to [SMART_CONTRACT_SPEC.md §2](SMART_CONTRACT_SPEC.md#2-roles-and-authority). "Safe proposal" means the admin console creates a Safe transaction that the required signers review and sign in Safe{Wallet}.

## 1. Register a vehicle project
1. **Operator**: create draft in admin → Projects. Enter title, issuer, make/model, VIN (encrypted, used only to derive the salted `assetId`).
2. Upload required documents (purchase agreement, title/registration or contractual-interest evidence, insurance, operating agreement, Rights Document). Each upload is hashed and submitted to AuditRegistry.
3. Submit `registerProject` (state DRAFT).
4. **Reviewer** (different person): review documents off-chain, then `verifyProject` → VERIFIED. If issues, return to DRAFT with reason.

Checklist before VERIFIED: Rights Document final and hashed; issuer formation documents hashed; risk factors written; no PII in any on-chain field.

## 2. Configure and open an offering
1. Governance view: enter unit price, payment token (from allowlist; decimals shown as read on-chain), min/max units (default 100/100), per-wallet max, start/end, treasury Safe, terms record.
2. Console validates and creates a Safe proposal for `ProjectFactory.deployProject` (if not yet deployed), `configure`, `open`, scheduled through the timelock.
3. After the delay, execute. State → OFFERING.

## 3. During the offering
- Monitor subscriptions and eligibility. If a subscriber's eligibility lapses or is revoked, governance decides whether to `excludeSubscriber` (refund) before settlement.
- Never promise allocation outside the contract's first-come rule.

## 4. Settle or fail
- Target met: **Operator** runs pre-check (all subscribers still eligible) then `settle`. Proceeds go to treasury; state FUNDED.
- Target missed after deadline: anyone may call `finalizeFailed`; console shows a button. Notify subscribers that refunds are claimable.
- Cancellation for cause: governance `cancel` via Safe proposal with reason document.

## 5. Activate
Governance transitions FUNDED → ACTIVE with an evidence record (e.g. vehicle delivered, insured, registered for service). The evidence is an attestation; label it as such on the project page.

## 6. Periodic financial reporting
1. **Operator** prepares the report for the period (revenue lines, expense lines, reserves, distributable amount) with evidence attachments. Schema validation must pass.
2. Submit → hash anchored (SUBMITTED).
3. **Reviewer** checks figures against evidence; approves or rejects with reason. Self-review is blocked.
4. Amendments: submit an amendment referencing the previous report; the old one becomes SUPERSEDED on approval. Never edit an anchored report.

## 7. Distribution batch
1. **Operator** opens Distributions → New batch: choose approved report, amount (≤ remaining distributable for that period), snapshot block (period end). Console shows holder list from the indexer and a TS preview of every allocation, fee and dust.
2. Reconciliation must be clean; otherwise the console blocks proposals.
3. Submit `proposeBatch`. Console compares on-chain `AllocationRecorded` events with the preview; any mismatch → do not approve, open an incident.
4. Treasury Safe approves the exact stablecoin amount to the distributor.
5. **Reviewer** approves the batch (Safe proposal). Funds pulled; fee sent to fee recipient; state CLAIMABLE.
6. Publish the report page; notify holders.

## 8. Compliance operations
- Eligibility updates flow from the KYC provider through the relayer automatically.
- Manual freeze (e.g. sanctions hit): Compliance → Wallets → Freeze, with reason code. Unfreeze requires governance.
- Expiry reminders sent to investors ahead of `expiresAt`.

## 9. Exit and termination
1. Governance moves ACTIVE/SUSPENDED → EXIT_PENDING (sale, retirement, replacement) or → TERMINATED (exceptional), with evidence. Transfers freeze.
2. Final report includes sale proceeds and wind-down costs; normal report + batch flow.
3. When the final batch is CLAIMABLE and no batch is pending, governance closes the project (CLOSED) and may sweep residual dust to treasury.
4. Unclaimed allocations remain claimable.
5. Replacement vehicle = new project with a new asset ID; it is not a continuation of the old token unless a documented migration is approved.

## 10. Emergency controls
- Guardian pauses via Safe (token / offering / distributor / identity). See [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
- Unpause requires governance via timelock.

## 11. Role management
- All grants/revokes are governance Safe proposals through the timelock. Console shows current holders from the indexer and pending timelock operations.
- Quarterly access review: compare on-chain holders, staff accounts, and Safe signers.

## 12. Exports
Admin → Exports: project register, holdings at block, subscriptions, reports, batches and allocations (CSV). Every export is logged in `admin_action`.
