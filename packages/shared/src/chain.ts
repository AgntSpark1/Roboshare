/** Mirrors IRoboShare.sol enums. Order matters: values are the Solidity uint8. */
export const PROJECT_STATES = [
  "NONE",
  "DRAFT",
  "VERIFIED",
  "OFFERING",
  "FUNDED",
  "ACTIVE",
  "SUSPENDED",
  "EXIT_PENDING",
  "TERMINATED",
  "CLOSED",
  "CANCELLED",
] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

export const RECORD_KINDS = ["DOCUMENT", "FINANCIAL_REPORT", "EVIDENCE", "ATTESTATION"] as const;
export const RECORD_STATUSES = ["NONE", "SUBMITTED", "APPROVED", "REJECTED", "SUPERSEDED"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];
export type RecordKind = (typeof RECORD_KINDS)[number];

export const SHARE_CAP = 100;

export function projectStateName(v: number): ProjectState {
  const s = PROJECT_STATES[v];
  if (!s) throw new RangeError(`unknown project state ${v}`);
  return s;
}
