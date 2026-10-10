-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "chain";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "compliance";

-- CreateEnum
CREATE TYPE "app"."ProjectState" AS ENUM ('NONE', 'DRAFT', 'VERIFIED', 'OFFERING', 'FUNDED', 'ACTIVE', 'SUSPENDED', 'EXIT_PENDING', 'TERMINATED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "app"."OfferingStatus" AS ENUM ('CONFIGURED', 'OPEN', 'SETTLED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "app"."SubscriptionStatus" AS ENUM ('ESCROWED', 'SETTLED', 'REFUNDABLE', 'REFUNDED');

-- CreateEnum
CREATE TYPE "app"."EligibilityState" AS ENUM ('NONE', 'ELIGIBLE', 'FROZEN');

-- CreateEnum
CREATE TYPE "app"."ReportStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "app"."ReportSection" AS ENUM ('REVENUE', 'EXPENSE', 'RESERVE');

-- CreateEnum
CREATE TYPE "app"."BatchStatus" AS ENUM ('PROPOSED', 'CLAIMABLE', 'REJECTED');

-- CreateTable
CREATE TABLE "chain"."block" (
    "chainId" INTEGER NOT NULL,
    "number" BIGINT NOT NULL,
    "hash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "block_pkey" PRIMARY KEY ("chainId","number")
);

-- CreateTable
CREATE TABLE "chain"."event" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain"."indexer_cursor" (
    "chainId" INTEGER NOT NULL,
    "lastBlock" BIGINT NOT NULL,
    "lastHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexer_cursor_pkey" PRIMARY KEY ("chainId")
);

-- CreateTable
CREATE TABLE "chain"."contract_deployment" (
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "projectId" TEXT,
    "deployedBlock" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_deployment_pkey" PRIMARY KEY ("chainId","address")
);

-- CreateTable
CREATE TABLE "chain"."contract_role_grant" (
    "chainId" INTEGER NOT NULL,
    "contract" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "eventId" UUID NOT NULL,

    CONSTRAINT "contract_role_grant_pkey" PRIMARY KEY ("chainId","contract","role","account")
);

-- CreateTable
CREATE TABLE "chain"."reconciliation_run" (
    "id" UUID NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "block" BIGINT NOT NULL,
    "ok" BOOLEAN NOT NULL,

    CONSTRAINT "reconciliation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain"."reconciliation_issue" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "actual" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "reconciliation_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."project" (
    "projectIdOnchain" TEXT NOT NULL,
    "assetIdOnchain" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "rightsDocHash" TEXT NOT NULL,
    "registrant" TEXT NOT NULL,
    "state" "app"."ProjectState" NOT NULL,
    "tokenAddress" TEXT,
    "offeringAddress" TEXT,
    "distributorAddress" TEXT,
    "fundedAtBlock" BIGINT,
    "registeredBlock" BIGINT NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("projectIdOnchain")
);

-- CreateTable
CREATE TABLE "app"."project_meta" (
    "projectIdOnchain" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "modelYear" INTEGER,
    "summary" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_meta_pkey" PRIMARY KEY ("projectIdOnchain")
);

-- CreateTable
CREATE TABLE "app"."project_state_change" (
    "id" UUID NOT NULL,
    "projectIdOnchain" TEXT NOT NULL,
    "fromState" "app"."ProjectState" NOT NULL,
    "toState" "app"."ProjectState" NOT NULL,
    "reasonHash" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "eventId" UUID NOT NULL,

    CONSTRAINT "project_state_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."offering" (
    "projectIdOnchain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "app"."OfferingStatus" NOT NULL,
    "unitPrice" DECIMAL(78,0) NOT NULL,
    "minUnits" INTEGER NOT NULL,
    "maxUnits" INTEGER NOT NULL,
    "perWalletMax" INTEGER NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "treasury" TEXT NOT NULL,
    "termsHash" TEXT NOT NULL,
    "unitsSold" INTEGER NOT NULL DEFAULT 0,
    "proceeds" DECIMAL(78,0),

    CONSTRAINT "offering_pkey" PRIMARY KEY ("projectIdOnchain")
);

-- CreateTable
CREATE TABLE "app"."subscription" (
    "projectIdOnchain" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "status" "app"."SubscriptionStatus" NOT NULL,
    "lastTxHash" TEXT NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("projectIdOnchain","wallet")
);

-- CreateTable
CREATE TABLE "app"."token_transfer" (
    "id" UUID NOT NULL,
    "projectIdOnchain" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "eventId" UUID NOT NULL,

    CONSTRAINT "token_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."holding" (
    "projectIdOnchain" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "lastBlock" BIGINT NOT NULL,

    CONSTRAINT "holding_pkey" PRIMARY KEY ("projectIdOnchain","wallet")
);

-- CreateTable
CREATE TABLE "app"."eligibility" (
    "wallet" TEXT NOT NULL,
    "status" "app"."EligibilityState" NOT NULL,
    "investorClass" INTEGER,
    "jurisdiction" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "attestationRef" TEXT,
    "lastBlock" BIGINT NOT NULL,

    CONSTRAINT "eligibility_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "app"."audit_record" (
    "recordIdOnchain" TEXT NOT NULL,
    "projectIdOnchain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "supersedes" TEXT,
    "supersededBy" TEXT,
    "periodStart" BIGINT NOT NULL,
    "periodEnd" BIGINT NOT NULL,
    "distributableAmount" DECIMAL(78,0) NOT NULL,
    "paymentToken" TEXT NOT NULL,
    "submitter" TEXT NOT NULL,
    "reviewer" TEXT,
    "submittedBlock" BIGINT NOT NULL,

    CONSTRAINT "audit_record_pkey" PRIMARY KEY ("recordIdOnchain")
);

-- CreateTable
CREATE TABLE "app"."financial_report" (
    "id" UUID NOT NULL,
    "projectIdOnchain" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "paymentToken" TEXT NOT NULL,
    "grossRevenue" DECIMAL(78,0) NOT NULL,
    "totalExpenses" DECIMAL(78,0) NOT NULL,
    "totalReserves" DECIMAL(78,0) NOT NULL,
    "distributableAmount" DECIMAL(78,0) NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "status" "app"."ReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "supersedesId" UUID,
    "submittedByUserId" UUID NOT NULL,
    "submittedByWallet" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordIdOnchain" TEXT,

    CONSTRAINT "financial_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."report_line" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "section" "app"."ReportSection" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,

    CONSTRAINT "report_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."report_review" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "reviewerUserId" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."distribution_batch" (
    "projectIdOnchain" TEXT NOT NULL,
    "batchIdOnchain" INTEGER NOT NULL,
    "reportId" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "pool" DECIMAL(78,0) NOT NULL,
    "totalNet" DECIMAL(78,0) NOT NULL,
    "totalFee" DECIMAL(78,0) NOT NULL,
    "dustOut" DECIMAL(78,0) NOT NULL,
    "snapshotBlock" BIGINT NOT NULL,
    "status" "app"."BatchStatus" NOT NULL,
    "proposeTxHash" TEXT NOT NULL,
    "approveTxHash" TEXT,
    "approver" TEXT,

    CONSTRAINT "distribution_batch_pkey" PRIMARY KEY ("projectIdOnchain","batchIdOnchain")
);

-- CreateTable
CREATE TABLE "app"."distribution_allocation" (
    "projectIdOnchain" TEXT NOT NULL,
    "batchIdOnchain" INTEGER NOT NULL,
    "wallet" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "gross" DECIMAL(78,0) NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "net" DECIMAL(78,0) NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "claimTxHash" TEXT,

    CONSTRAINT "distribution_allocation_pkey" PRIMARY KEY ("projectIdOnchain","batchIdOnchain","wallet")
);

-- CreateTable
CREATE TABLE "app"."user" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."wallet" (
    "address" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "app"."staff_account" (
    "userId" UUID NOT NULL,
    "roles" TEXT[],
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "staff_account_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "app"."admin_action" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "wallet" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance"."compliance_case" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "compliance_case_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_chainId_blockNumber_logIndex_idx" ON "chain"."event"("chainId", "blockNumber", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "event_chainId_txHash_logIndex_key" ON "chain"."event"("chainId", "txHash", "logIndex");

-- CreateIndex
CREATE INDEX "contract_role_grant_account_idx" ON "chain"."contract_role_grant"("account");

-- CreateIndex
CREATE UNIQUE INDEX "project_assetIdOnchain_key" ON "app"."project"("assetIdOnchain");

-- CreateIndex
CREATE UNIQUE INDEX "project_meta_slug_key" ON "app"."project_meta"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "project_state_change_eventId_key" ON "app"."project_state_change"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "offering_address_key" ON "app"."offering"("address");

-- CreateIndex
CREATE INDEX "subscription_wallet_idx" ON "app"."subscription"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "token_transfer_eventId_key" ON "app"."token_transfer"("eventId");

-- CreateIndex
CREATE INDEX "token_transfer_projectIdOnchain_blockNumber_idx" ON "app"."token_transfer"("projectIdOnchain", "blockNumber");

-- CreateIndex
CREATE INDEX "token_transfer_toAddress_idx" ON "app"."token_transfer"("toAddress");

-- CreateIndex
CREATE INDEX "token_transfer_fromAddress_idx" ON "app"."token_transfer"("fromAddress");

-- CreateIndex
CREATE INDEX "holding_wallet_idx" ON "app"."holding"("wallet");

-- CreateIndex
CREATE INDEX "audit_record_projectIdOnchain_idx" ON "app"."audit_record"("projectIdOnchain");

-- CreateIndex
CREATE UNIQUE INDEX "financial_report_canonicalHash_key" ON "app"."financial_report"("canonicalHash");

-- CreateIndex
CREATE UNIQUE INDEX "financial_report_recordIdOnchain_key" ON "app"."financial_report"("recordIdOnchain");

-- CreateIndex
CREATE INDEX "financial_report_projectIdOnchain_periodStart_periodEnd_idx" ON "app"."financial_report"("projectIdOnchain", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "distribution_allocation_wallet_idx" ON "app"."distribution_allocation"("wallet");

-- CreateIndex
CREATE INDEX "admin_action_createdAt_idx" ON "app"."admin_action"("createdAt");

-- CreateIndex
CREATE INDEX "compliance_case_wallet_idx" ON "compliance"."compliance_case"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_case_provider_providerRef_key" ON "compliance"."compliance_case"("provider", "providerRef");

-- AddForeignKey
ALTER TABLE "chain"."reconciliation_issue" ADD CONSTRAINT "reconciliation_issue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "chain"."reconciliation_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."project_state_change" ADD CONSTRAINT "project_state_change_projectIdOnchain_fkey" FOREIGN KEY ("projectIdOnchain") REFERENCES "app"."project"("projectIdOnchain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."offering" ADD CONSTRAINT "offering_projectIdOnchain_fkey" FOREIGN KEY ("projectIdOnchain") REFERENCES "app"."project"("projectIdOnchain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."subscription" ADD CONSTRAINT "subscription_projectIdOnchain_fkey" FOREIGN KEY ("projectIdOnchain") REFERENCES "app"."offering"("projectIdOnchain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."holding" ADD CONSTRAINT "holding_projectIdOnchain_fkey" FOREIGN KEY ("projectIdOnchain") REFERENCES "app"."project"("projectIdOnchain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."report_line" ADD CONSTRAINT "report_line_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "app"."financial_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."report_review" ADD CONSTRAINT "report_review_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "app"."financial_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."distribution_batch" ADD CONSTRAINT "distribution_batch_projectIdOnchain_fkey" FOREIGN KEY ("projectIdOnchain") REFERENCES "app"."project"("projectIdOnchain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."distribution_allocation" ADD CONSTRAINT "distribution_allocation_projectIdOnchain_batchIdOnchain_fkey" FOREIGN KEY ("projectIdOnchain", "batchIdOnchain") REFERENCES "app"."distribution_batch"("projectIdOnchain", "batchIdOnchain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."wallet" ADD CONSTRAINT "wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."staff_account" ADD CONSTRAINT "staff_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
