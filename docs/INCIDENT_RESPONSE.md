# RoboShare — Incident Response Plan

Status: **DRAFT (Phase 1).** On-call tooling, contacts and vendors are not yet chosen.

## 1. Severity

| Sev | Definition | Examples | Response |
|---|---|---|---|
| SEV-1 | Funds at risk or actively lost; governance compromise | exploit draining distributor; unexpected `RoleGranted`; malicious timelock operation scheduled | immediate pause, all hands |
| SEV-2 | Incorrect financial state, no confirmed loss | batch allocation mismatch; reconciliation money mismatch; relayer key misuse | block affected flows, within 1 hour |
| SEV-3 | Degraded service | indexer lag, RPC outage, UI down | business hours |
| SEV-4 | Minor | cosmetic, docs | backlog |

## 2. Roles
Incident commander (IC), guardian signers (pause), governance signers, engineering lead, compliance lead, communications lead, legal counsel.

## 3. SEV-1 playbook
1. **Detect**: alert (monitoring, reconciliation, user report, auditor).
2. **Contain** (minutes): guardian Safe signs `pause()` on affected contracts. If a malicious timelock operation is pending, guardian cancels it. Revoke compromised relayer role via governance if possible; disable relayer in the backend immediately.
3. **Assess**: identify affected contracts, projects, holders, amounts. Preserve evidence (tx hashes, logs, DB snapshot).
4. **Communicate**: status page + in-app banner with facts only; no speculation; legal review for regulator/investor notifications as required by jurisdiction.
5. **Remediate**: fix, test, and deploy replacement contracts for new projects; for affected projects, decide migration per SECURITY_MODEL §5. Unpause only via governance after review.
6. **Recover**: reconcile, publish a post-mortem with timeline, impact and corrective actions.

## 4. Specific scenarios

| Scenario | First actions |
|---|---|
| Wrong batch allocation proposed | Reviewer rejects batch; operator investigates holder list/snapshot; no funds have moved |
| Wrong batch already approved | Pause distributor; compute correct allocations; governance decides on corrective batch funded by issuer; disclose |
| Fraudulent report discovered | Freeze further batches for the project (suspend); preserve evidence; submit amendment; legal escalation |
| Compliance relayer key leaked | Disable relayer; governance revokes `COMPLIANCE_AGENT_ROLE`; review all eligibility changes since compromise; freeze wallets wrongly marked eligible; rotate key |
| Governance signer key lost/compromised | Remaining signers rotate Safe owners; review pending timelock ops; guardian ready to cancel |
| Stablecoin depeg or issuer freeze | Pause offerings/distributions in that token; disclose; governance decides on payment asset for future batches |
| Chain halt / deep reorg | Stop indexer confirmations; mark data stale in UI; resume after chain recovers and reconcile |
| Data breach (PII) | Contain access, rotate credentials, assess scope, legal notification duties, inform affected users |
| Phishing campaign | Publish warnings, report domains, reinforce official addresses in UI |

## 5. Pause semantics (current default, under review)
While paused: subscriptions, settlement, transfers, claims and refunds are blocked. This stops drains during an exploit but also blocks investor exits; the pause should be held only as long as needed and the governance decision to unpause is time-critical. See THREAT_MODEL T-14.

## 6. After every incident
Post-mortem within 5 business days; tracked corrective actions; update THREAT_MODEL and tests to cover the failure.
