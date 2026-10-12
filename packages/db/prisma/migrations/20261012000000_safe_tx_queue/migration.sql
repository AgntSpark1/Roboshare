-- Governance Safe transactions confirmed and executed from the admin console (ADMIN_AUTOMATION_PLAN.md)
CREATE TABLE "app"."safe_tx" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "safe" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "operation" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "calls" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "safeNonce" INTEGER,
    "execTxHash" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closeReason" TEXT,

    CONSTRAINT "safe_tx_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "safe_tx_status_createdAt_idx" ON "app"."safe_tx"("status", "createdAt");

-- Two pending transactions can never claim the same Safe nonce.
CREATE UNIQUE INDEX "safe_tx_pending_nonce_key" ON "app"."safe_tx"("chainId", "safe", "safeNonce") WHERE "status" = 'PENDING' AND "safeNonce" IS NOT NULL;
