-- CreateTable
CREATE TABLE "chain"."aave_market_snapshot" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "blockTime" TIMESTAMP(3) NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "addresses" JSONB NOT NULL,
    "reserves" JSONB NOT NULL,

    CONSTRAINT "aave_market_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aave_market_snapshot_chainId_blockNumber_idx" ON "chain"."aave_market_snapshot"("chainId", "blockNumber");
