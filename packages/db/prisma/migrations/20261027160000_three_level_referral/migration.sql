-- Flat 30% platform share and three-level referral rewards (REFERRAL_DESIGN.md §10)
ALTER TABLE "app"."project" ADD COLUMN "feeTiers" JSONB;
ALTER TABLE "app"."referral_accrual" ADD COLUMN "gross" DECIMAL(78,0) NOT NULL DEFAULT 0;
