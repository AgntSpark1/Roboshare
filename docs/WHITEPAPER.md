# RoboShare Whitepaper (Draft)

**Version 0.1 — Phase 1 draft for internal review.** This is not an offer to sell or a solicitation to buy any security or investment. No offering exists. No legal, tax, or regulatory review has taken place. Statements marked **[Assumption]** or **[Unverified]** have not been confirmed.

## 1. Summary

RoboShare is a platform for issuing and servicing legally defined investment interests in individual Robotaxi vehicle projects. Each project is organized through an issuing entity, documented off-chain, and represented on BNB Smart Chain by a restricted-transfer token capped at 100 whole units. Distributions of verified project profit are calculated and paid on-chain against approved financial reports, with a tiered operator fee.

The platform's purpose is transparency and auditability: who holds what, what was reported, who approved it, and what was paid, all linked by document hashes and transaction records.

## 2. Problem

Investing in a single revenue-generating vehicle is difficult for individuals: legal structuring is per asset, record-keeping is opaque, distributions are manual, and investors rarely see the evidence behind reported numbers.

## 3. Approach

1. **One project, one vehicle, one issuer reference, one token.** Separate accounting per project by construction.
2. **Legal rights first.** A per-project Rights Document defines what a unit is. **[Assumption, D-1]** The default is a contractual economic right to 1 % of the project's distributable profit, not vehicle ownership.
3. **Evidence, not claims.** Purchase, insurance, and operating documents are hashed and anchored. A hash shows a document is unchanged; it does not prove the document is genuine. Lifecycle changes are attestations by named roles.
4. **Two-person rule** for reports, distributions, and project verification.
5. **Restricted transfers** to eligible wallets, enforced in the token.

## 4. Asset-interest structure

```
Investor ──holds──> RwaShareToken units (max 100, decimals 0)
                        │ defined by
                        ▼
                  Rights Document (hash on-chain)
                        │ issued by
                        ▼
              Issuing entity (SPV or equivalent) [Unverified: structure TBD by counsel]
                        │ owns / operates under contract
                        ▼
                     Vehicle (asset ID = salted hash of VIN)
```

Whether a vehicle may be deployed in a commercial Robotaxi network, on what terms, and with which platform operator, is **[Unverified]**. RoboShare has no partnership with Tesla, and no Tesla data API is assumed. Operating data is entered through a manual, reviewed reporting process.

## 5. Token issuance

- Authorized supply 100 units per project, immutable.
- Sold through an offering with a fixed unit price in an allowlisted stablecoin, escrowed until settlement.
- **[Assumption, D-4]** All-or-nothing: if 100 units are not subscribed by the deadline, all subscribers are refunded.
- Units are minted at settlement to subscribers who are still eligible. Proceeds go to the issuer treasury.
- See [TOKENOMICS.md](TOKENOMICS.md).

## 6. Financial model

### 6.1 Distributable profit
Revenue − operating costs − approved reserves − priority obligations (debt service, taxes, legal priorities) = distributable profit, per reporting period, as stated in a reviewed report. No revenue, cost, utilization, vehicle price or return figure is assumed in this paper. Any projection shown in the product is labelled **Projected** and kept separate from **Actual** figures.

### 6.2 Fee tiers (proposed)
| Units held | Operator share of holder's allocation |
|---|---|
| 1–4 | 20 % |
| 5–9 | 17.5 % |
| 10–19 | 15 % |
| 20–49 | 12.5 % |
| 50–100 | 10 % |

Example: distributable profit 10 000, holder of 10 units → gross 1 000, operator 150, investor 850. This assumes equal economic rights per unit and no other priority allocations. These tiers are proposed business rules, not market standards.

### 6.3 Distribution mechanics
Snapshot at period end; allocation computed on-chain; holders claim; rounding dust carried forward; unclaimed amounts remain claimable and are not swept to the operator.

## 7. Technical architecture

- **Chain:** BNB Smart Chain (testnet first). Single-chain MVP.
- **Contracts:** AssetRegistry, AuditRegistry, IdentityRegistry, ProjectFactory, and per project RwaShareToken, OfferingManager, RevenueDistributor. Non-upgradeable. OpenZeppelin-based.
- **Off-chain:** NestJS API and workers, PostgreSQL, Redis, encrypted object storage, Next.js web app with wagmi/viem.
- **Indexing:** confirmed-block indexer with reorg handling; scheduled reconciliation against contract state.
- **DeFi:** read-only display of Aave V3 market data on BNB Smart Chain after address verification. Investor funds are never automatically deposited into Aave, and the RoboShare token is not assumed to be accepted as collateral anywhere.
- Details: [ARCHITECTURE.md](ARCHITECTURE.md), [SMART_CONTRACT_SPEC.md](SMART_CONTRACT_SPEC.md).

## 8. Governance

- Governance multisig behind a timelock holds admin authority; a separate guardian multisig can only pause.
- Operators submit; reviewers approve; the same key cannot do both.
- No role can mint beyond the cap, take investor escrow, or rewrite records.
- Changes to fee tiers or token logic apply only to new projects.

## 9. Compliance posture

Using a restricted token or a particular legal entity does **not** make the platform legally compliant. Offering, transfer, custody, tax, and data-protection obligations depend on jurisdiction and the instrument's legal classification, and must be determined by counsel before any offering. Eligibility checks will be performed by a third-party provider (TBD); development builds use a clearly marked TEST-ONLY mock.

## 10. Risks

See [RISK_DISCLOSURES.md](RISK_DISCLOSURES.md). Principal risks: loss of capital, no guaranteed income, vehicle and operating risk, regulatory risk for autonomous vehicles and for tokenized interests, dependence on the operator and third-party platforms, illiquidity, smart contract risk, stablecoin risk, and key-management risk.

## 11. Roadmap

Phase 1 architecture (this draft) → Phase 2 core contracts → Phase 3 backend → Phase 4 frontend → Phase 5 Aave read-only → Phase 6 security and testnet → external audit and legal sign-off → mainnet only on explicit approval. See [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md).

## 12. What this paper does not claim

No Tesla partnership, no approved operating locations, no vehicle prices, no historical returns, no investor commitments, no guaranteed yields, no regulatory approval.
