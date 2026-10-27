-- CreateTable
CREATE TABLE "app"."city_reward" (
    "mintEventId" UUID NOT NULL,
    "projectIdOnchain" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "leader" TEXT NOT NULL,
    "mintedUnits" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "reward" DECIMAL(78,0) NOT NULL,
    "mintedAt" TIMESTAMP(3) NOT NULL,
    "month" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "city_reward_pkey" PRIMARY KEY ("mintEventId")
);

-- CreateIndex
CREATE INDEX "city_reward_leader_idx" ON "app"."city_reward"("leader");

-- CreateIndex
CREATE INDEX "city_reward_wallet_idx" ON "app"."city_reward"("wallet");

