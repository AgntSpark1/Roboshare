-- Two-level referral rewards (REFERRAL_DESIGN.md §8)
ALTER TABLE "app"."referral_accrual" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "app"."referral_accrual" DROP CONSTRAINT "referral_accrual_pkey";
ALTER TABLE "app"."referral_accrual" ADD CONSTRAINT "referral_accrual_pkey" PRIMARY KEY ("projectIdOnchain","batchIdOnchain","referee","level");
