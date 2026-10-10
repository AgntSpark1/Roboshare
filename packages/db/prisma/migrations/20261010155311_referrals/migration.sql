-- CreateTable
CREATE TABLE "app"."referral" (
    "referee" TEXT NOT NULL,
    "referrer" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "boundBlock" BIGINT NOT NULL,
    "boundTxHash" TEXT NOT NULL,

    CONSTRAINT "referral_pkey" PRIMARY KEY ("referee")
);

-- CreateTable
CREATE TABLE "app"."referral_accrual" (
    "projectIdOnchain" TEXT NOT NULL,
    "batchIdOnchain" INTEGER NOT NULL,
    "referee" TEXT NOT NULL,
    "referrer" TEXT NOT NULL,
    "fee" DECIMAL(78,0) NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "reward" DECIMAL(78,0) NOT NULL,

    CONSTRAINT "referral_accrual_pkey" PRIMARY KEY ("projectIdOnchain","batchIdOnchain","referee")
);

-- CreateTable
CREATE TABLE "app"."referral_root" (
    "epoch" INTEGER NOT NULL,
    "root" TEXT NOT NULL,
    "dataHash" TEXT NOT NULL,
    "totalCumulative" DECIMAL(78,0) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,

    CONSTRAINT "referral_root_pkey" PRIMARY KEY ("epoch")
);

-- CreateTable
CREATE TABLE "app"."referral_claim" (
    "account" TEXT NOT NULL,
    "claimed" DECIMAL(78,0) NOT NULL,
    "lastTxHash" TEXT NOT NULL,

    CONSTRAINT "referral_claim_pkey" PRIMARY KEY ("account")
);

-- CreateTable
CREATE TABLE "app"."referral_tree" (
    "root" TEXT NOT NULL,
    "dataHash" TEXT NOT NULL,
    "totalCumulative" DECIMAL(78,0) NOT NULL,
    "entries" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" UUID NOT NULL,

    CONSTRAINT "referral_tree_pkey" PRIMARY KEY ("root")
);

-- CreateIndex
CREATE INDEX "referral_referrer_idx" ON "app"."referral"("referrer");

-- CreateIndex
CREATE INDEX "referral_accrual_referrer_idx" ON "app"."referral_accrual"("referrer");
