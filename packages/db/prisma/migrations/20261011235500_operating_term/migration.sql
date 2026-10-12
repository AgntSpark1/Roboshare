-- Operating term and fee-free capital return (OPERATING_TERM_PROPOSAL.md)
ALTER TABLE "app"."project" ADD COLUMN "termDays" INTEGER;
ALTER TABLE "app"."project" ADD COLUMN "operatingStartedAt" TIMESTAMP(3);
ALTER TABLE "app"."distribution_batch" ADD COLUMN "capitalReturn" BOOLEAN NOT NULL DEFAULT false;
