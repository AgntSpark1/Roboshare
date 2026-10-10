-- AlterTable
ALTER TABLE "app"."staff_account" ADD COLUMN     "totpSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "app"."risk_acknowledgement" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "wallet" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_acknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."pending_tx" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_tx_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "risk_acknowledgement_userId_version_key" ON "app"."risk_acknowledgement"("userId", "version");

-- CreateIndex
CREATE INDEX "pending_tx_userId_idx" ON "app"."pending_tx"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "pending_tx_chainId_hash_key" ON "app"."pending_tx"("chainId", "hash");
