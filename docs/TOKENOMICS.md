# RoboShare — Tokenomics

Status: **DRAFT (Phase 1).** The fee tiers and unit structure below are **proposed business rules**, not verified market standards. They have not been reviewed by counsel or tax advisers. All numbers in examples are illustrative.

## 1. What a unit is

- Each vehicle project issues its own token (`RwaShareToken`), one contract per project.
- **Authorized supply: 100 whole units per project, immutable.** `decimals = 0`; fractions do not exist.
- Default legal meaning (decision D-1, pending counsel): **one unit = a contractual economic right to 1 % of the project's distributable profit pool**, as defined in that project's Rights Document. The Rights Document hash is stored on-chain in `AssetRegistry`.
- A unit is **not** ownership of the vehicle, **not** a share of the operator, and **not** a claim on any other project, unless a project's Rights Document explicitly and lawfully says otherwise.
- Alternatives (SPV equity, debt note) are different instruments with different rights, priorities and regulatory treatment. They are not interchangeable and would each need their own Rights Document template and possibly different transfer rules.

## 2. Issuance

| Item | Rule |
|---|---|
| Who can mint | Only the project's `OfferingManager`, bound once at deployment |
| When | At settlement of a successful offering (D-5) |
| Max | 100 units; cap enforced in the token |
| Fill rule | All-or-nothing by default (D-4): fewer than 100 subscribed by the deadline → offering cancelled, full refunds |
| Price | `unitPrice` set per offering before launch, in an allowlisted stablecoin's base units. No price is assumed in these docs |
| Unsold units | Under all-or-nothing there are none. If a lower minimum is ever enabled, unissued units are never minted and distributions are pro-rata over **issued** units, so each issued unit then represents more than 1 %. This is why the default is all-or-nothing |
| Burn | None in MVP. Units remain after `CLOSED` as a historical record |

## 3. Transfers

- Peer-to-peer between eligible wallets only (eligibility, not frozen, investor class allowed for the project).
- Allowed only while the project is `FUNDED` or `ACTIVE` (D-12).
- No official secondary market in the MVP (D-19). DEX pools, lending markets and bridges will generally fail eligibility checks; the token should be treated as **illiquid**.
- ERC-20 interface and events are standard, but restricted transfers revert. It is accurate to call the token "ERC-20 interface-compatible with transfer restrictions"; it is not accurate to call it freely transferable.

## 4. Distribution model

### 4.1 Waterfall (performed off-chain, evidenced by an approved report)

1. Confirm actual project revenue for the period.
2. Deduct documented operating costs (charging, cleaning, maintenance, insurance, platform/fleet fees, depreciation treatment as defined).
3. Deduct approved reserves and priority obligations (debt service, taxes payable by the issuer, legal priorities).
4. Result = **distributable profit D** for the period, recorded in the financial report and anchored in `AuditRegistry` with status `APPROVED`.
5. Batches for that period may distribute at most D in total.

If D ≤ 0, no batch is created, and the operator fee is zero (D-9). Loss carry-forward rules are not yet defined.

### 4.2 Per-holder allocation (performed on-chain)

```
grossᵢ = floor(D × uᵢ / U)
feeᵢ   = floor(grossᵢ × tierBps(uᵢ) / 10 000)
netᵢ   = grossᵢ − feeᵢ
dust   = D − Σ grossᵢ
```

- `uᵢ` = holder's units at the snapshot block (end of reporting period, D-7); `U` = total issued units at the same block.
- Tier is based on units **in this project only** (D-6), at the snapshot.
- Units bought after the snapshot earn nothing for that period; units sold before it earn nothing for that period.

### 4.3 Proposed operator-fee tiers

| Units held (per project, at snapshot) | Operator share of the holder's gross allocation | Basis points |
|---|---|---|
| 1–4 | 20 % | 2 000 |
| 5–9 | 17.5 % | 1 750 |
| 10–19 | 15 % | 1 500 |
| 20–49 | 12.5 % | 1 250 |
| 50–100 | 10 % | 1 000 |

Tiers are fixed in each project's `RevenueDistributor` at deployment. Changing tiers applies only to new projects and must be disclosed in that project's offering terms.

### 4.4 Worked example (illustrative only)

Assume D = 10 000 stablecoin units for a period, U = 100 units issued, holders: A 50, B 25, C 10, D 9, E 4, F 2.

| Holder | Units | Gross | Tier | Fee | Net |
|---|---|---|---|---|---|
| A | 50 | 5 000 | 10 % | 500 | 4 500 |
| B | 25 | 2 500 | 12.5 % | 312.5 | 2 187.5 |
| C | 10 | 1 000 | 15 % | 150 | 850 |
| D | 9 | 900 | 17.5 % | 157.5 | 742.5 |
| E | 4 | 400 | 20 % | 80 | 320 |
| F | 2 | 200 | 20 % | 40 | 160 |
| **Total** | **100** | **10 000** | | **1 240** | **8 760** |

On-chain, amounts are integer base units (e.g. 10 000 × 10¹⁸ for an 18-decimal stablecoin), so 312.5 is exactly representable and dust is at most a few base units.

Note the effective operator take depends on the holder mix (12.4 % here). A single flat 20 % deduction from total profit would be wrong under these rules.

### 4.5 Rounding and dust (D-10)

- Fee is floored, so rounding on the fee split favours the investor.
- `dust = D − Σgross` (strictly less than the number of holders, in base units) is carried into the project's next batch pool and recorded on-chain.
- On `CLOSED`, residual dust is swept to the issuer treasury with an event.

### 4.6 Claims

- Pull-based: holders claim per batch; operator may `claimFor` a holder (funds still go to the holder).
- Frozen wallets cannot claim until unfrozen; entitlement is preserved (D-13).
- Unclaimed amounts are never swept to the operator.

## 5. Fees not covered by tiers

Any management fee, platform fee, or fleet-operator fee charged before distributable profit must appear as an expense line in the financial report and be disclosed in the offering terms. The tiered operator share is applied **only** to each holder's allocated profit. Whether separate management fees exist is unresolved (D-8).

## 6. Things the token does not do

- No yield promise, no guaranteed return, no redemption right unless a Rights Document grants one.
- No staking, governance voting, or protocol-level emissions.
- No automatic deposit of subscription funds into Aave or any DeFi protocol.
- Not accepted as Aave collateral; no such listing is assumed.
