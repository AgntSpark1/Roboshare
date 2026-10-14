-- Robot matchmaking: automatic listing and platform backstop (MATCHMAKER_DESIGN.md)
CREATE TABLE "app"."matchmaker_settings" (
    "chainId" INTEGER NOT NULL,
    "launchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "launchMode" TEXT NOT NULL DEFAULT 'SAFE',
    "maxOpen" INTEGER NOT NULL DEFAULT 1,
    "demoVehicles" BOOLEAN NOT NULL DEFAULT false,
    "backstopEnabled" BOOLEAN NOT NULL DEFAULT false,
    "backstopHoursBeforeEnd" INTEGER NOT NULL DEFAULT 1,
    "backstopMaxUsdt" INTEGER NOT NULL DEFAULT 10000,
    "autoActivate" BOOLEAN NOT NULL DEFAULT true,
    "launcherAddress" TEXT,
    "verifierAddress" TEXT,
    "backstopAddress" TEXT,
    "template" JSONB,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matchmaker_settings_pkey" PRIMARY KEY ("chainId")
);

CREATE TABLE "app"."vehicle_queue" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "modelYear" INTEGER,
    "summary" TEXT,
    "assetRef" TEXT NOT NULL,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "projectIdOnchain" TEXT,
    "safeTxId" UUID,
    "lastError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listedAt" TIMESTAMP(3),

    CONSTRAINT "vehicle_queue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_queue_slug_key" ON "app"."vehicle_queue"("slug");
CREATE UNIQUE INDEX "vehicle_queue_projectIdOnchain_key" ON "app"."vehicle_queue"("projectIdOnchain");
CREATE INDEX "vehicle_queue_chainId_status_createdAt_idx" ON "app"."vehicle_queue"("chainId", "status", "createdAt");
