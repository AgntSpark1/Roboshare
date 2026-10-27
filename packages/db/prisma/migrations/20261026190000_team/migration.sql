-- Promotion teams (REFERRAL_DESIGN.md §9)
CREATE TABLE "app"."team" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leader" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" UUID NOT NULL,

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_code_key" ON "app"."team"("code");
CREATE UNIQUE INDEX "team_leader_key" ON "app"."team"("leader");
