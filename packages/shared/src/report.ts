import { keccak256, stringToBytes } from "viem";
import { z } from "zod";

const AMOUNT_RE = /^(0|[1-9][0-9]*)$/;
const amount = z
  .string()
  .regex(AMOUNT_RE, "amount must be a non-negative integer string in base units");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const line = z.object({
  category: z.string().min(1).max(64),
  description: z.string().max(500).default(""),
  amount,
  evidenceDocumentVersionId: z.string().uuid().optional(),
});

export const reserveKind = z.enum(["MAINTENANCE", "INSURANCE", "TAX", "DEBT_SERVICE", "OTHER"]);

/** Financial report submitted by an operator (DATABASE_SCHEMA §3.6). Amounts are base-unit strings. */
export const financialReportSchema = z
  .object({
    projectId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    periodStart: isoDate,
    periodEnd: isoDate,
    paymentToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    revenue: z.array(line).min(1),
    expenses: z.array(line),
    reserves: z.array(
      z.object({ kind: reserveKind, amount, rationale: z.string().min(1).max(500) }),
    ),
    distributableAmount: amount,
  })
  .superRefine((r, ctx) => {
    // Field-level errors do not stop refinements in zod 3; skip the sums if any amount is malformed.
    const amounts = [...r.revenue, ...r.expenses, ...r.reserves, { amount: r.distributableAmount }];
    if (!amounts.every((x) => AMOUNT_RE.test(x.amount))) return;
    if (r.periodStart >= r.periodEnd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["periodEnd"], message: "periodEnd must be after periodStart" });
    }
    const sum = (xs: { amount: string }[]) => xs.reduce((s, x) => s + BigInt(x.amount), 0n);
    const expected = sum(r.revenue) - sum(r.expenses) - sum(r.reserves);
    if (expected < 0n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["distributableAmount"], message: "revenue is below expenses plus reserves" });
    } else if (BigInt(r.distributableAmount) !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributableAmount"],
        message: `distributableAmount must equal revenue - expenses - reserves (${expected})`,
      });
    }
  });

export type FinancialReport = z.infer<typeof financialReportSchema>;

/** Deterministic JSON: object keys sorted, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** keccak256 over the canonical JSON; this is the contentHash anchored in AuditRegistry. */
export function reportHash(report: FinancialReport): `0x${string}` {
  return keccak256(stringToBytes(canonicalJson(report)));
}

/** Seconds since epoch at 00:00 UTC, used for on-chain periodStart / periodEnd. */
export function dateToUnix(date: string): bigint {
  return BigInt(Date.parse(`${date}T00:00:00Z`) / 1000);
}
