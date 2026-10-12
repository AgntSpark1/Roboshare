-- Monthly distribution autopilot: its log, and the daily operating data it sums (ADMIN_AUTOMATION_PLAN.md)
CREATE TABLE "app"."automation_event" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "projectIdOnchain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "automation_event_createdAt_idx" ON "app"."automation_event"("createdAt");

-- Daily operating revenue and expenses per vehicle (Beijing date), summed monthly by the autopilot
CREATE TABLE "app"."daily_operating" (
    "projectIdOnchain" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "revenue" DECIMAL(78,0) NOT NULL,
    "expenses" DECIMAL(78,0) NOT NULL,
    "rides" INTEGER,
    "note" TEXT,
    "enteredBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_operating_pkey" PRIMARY KEY ("projectIdOnchain","day")
);
