# RoboShare

RoboShare is a planned platform for issuing and servicing legally defined investment interests in individual Robotaxi vehicle projects on BNB Smart Chain.

> **Status: Phase 1 (requirements and architecture), awaiting review.** This repository currently contains documentation only. No smart contract, backend, or frontend code exists yet; nothing has been compiled, tested, deployed, or audited. Nothing here is an offer of securities.

## What it does (target design)

- Registers each vehicle project with an asset ID, issuer reference, document hashes, and an enforced lifecycle.
- Issues one restricted-transfer, ERC-20-interface token per project: **100 whole units, decimals 0, immutable cap**.
- Runs escrowed, all-or-nothing offerings in an allowlisted stablecoin.
- Anchors financial reports, enforces submitter ≠ reviewer, and distributes verified profit on-chain with tiered operator fees and pull-based claims.
- Indexes chain state into PostgreSQL with reorg handling and reconciliation.
- Shows read-only Aave V3 market data from verified BNB Smart Chain deployments (no automatic deposits).

## Documentation

| Document | Purpose |
|---|---|
| [docs/PHASE1_ANALYSIS.md](docs/PHASE1_ANALYSIS.md) | **Start here.** Requirements analysis, diagrams, assumptions, open decisions, repo layout, tooling |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System components, data tiers, indexing, reconciliation |
| [docs/SMART_CONTRACT_SPEC.md](docs/SMART_CONTRACT_SPEC.md) | Contract modules, roles, functions, events, invariants |
| [docs/TOKENOMICS.md](docs/TOKENOMICS.md) | Unit structure, issuance, fee tiers, allocation formula |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | PostgreSQL entities and integrity rules |
| [docs/API_SPEC.md](docs/API_SPEC.md) | REST endpoints by visibility tier |
| [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) | Authority structure and controls |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | Assets, actors, threats, mitigations |
| [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md) | Phases and exit criteria |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | Test plan and required cases |
| [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | Deployment procedure (testnet first) |
| [docs/ADMIN_OPERATIONS.md](docs/ADMIN_OPERATIONS.md) | Operator runbooks |
| [docs/INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md) | Incident severity and playbooks |
| [docs/RISK_DISCLOSURES.md](docs/RISK_DISCLOSURES.md) | Draft investor risk disclosures |
| [docs/WHITEPAPER.md](docs/WHITEPAPER.md) | Draft whitepaper |

## Planned stack

Solidity + Foundry + OpenZeppelin Contracts v5 · BNB Smart Chain (testnet 97 → mainnet 56 after approval) · Next.js, React, TypeScript, Tailwind, shadcn/ui, wagmi/viem · NestJS, PostgreSQL, Prisma, Redis (BullMQ) · Docker Compose · GitHub Actions.

## Getting started (after Phase 2 begins)

See [PHASE1_ANALYSIS.md §10](docs/PHASE1_ANALYSIS.md#10-commands-and-tools-to-start-development).

## Important limits

- A token unit is not ownership of a vehicle unless the project's Rights Document says so.
- A document hash proves a file is unchanged, not that it is authentic.
- Lifecycle states are attestations by authorized roles, not proof of real-world events.
- No Tesla partnership, API, prices, returns, or locations are assumed.
- Restricted tokens do not by themselves make an offering legally compliant.
