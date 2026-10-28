import type { Prisma } from "@roboshare/db";

type Reader = Pick<Prisma.TransactionClient, "$queryRawUnsafe">;
type Baseline = { anchor: string; snapshot: Record<string, unknown[]> };

/** Optional, explicitly recorded state checkpoint for a database rebuilt without old receipts. */
export async function readRecoveryBaseline(db: Reader, chainId: number): Promise<Baseline | null> {
  const exists = await db.$queryRawUnsafe<{ relation: string | null }[]>("SELECT to_regclass('recovery.baseline')::text AS relation");
  if (!exists[0]?.relation) return null;
  const rows = await db.$queryRawUnsafe<Baseline[]>(
    'SELECT "anchorBlock"::text AS anchor, snapshot FROM recovery.baseline WHERE "chainId"=$1', chainId,
  );
  return rows[0] ?? null;
}

export async function restoreRecoveryBaseline(db: Prisma.TransactionClient, chainId: number): Promise<void> {
  const baseline = await readRecoveryBaseline(db, chainId);
  if (!baseline) return;
  // Only these derived tables may be restored. Do not insert invented transaction events.
  const tables = ["app.project", "app.offering", "app.holding", "app.audit_record", "app.eligibility", "chain.contract_deployment", "chain.contract_role_grant"];
  for (const table of tables) {
    const rows = baseline.snapshot[table] ?? [];
    if (rows.length) await db.$executeRawUnsafe(
      `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb) ON CONFLICT DO NOTHING`, JSON.stringify(rows),
    );
  }
}
