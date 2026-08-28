-- Unified contact database, monthly processing ledger and resumable issue log.
CREATE TYPE "ContactRelevanceStatus" AS ENUM ('RELEVANT', 'IRRELEVANT');

ALTER TABLE "ProspectingRun" ADD COLUMN "completionReason" TEXT;

ALTER TABLE "Contact"
  ADD COLUMN "customFields" JSONB,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'USER_UPLOAD',
  ADD COLUMN "sourceCompanyId" TEXT,
  ADD COLUMN "role" TEXT,
  ADD COLUMN "domain" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "verificationState" "EmailVerificationState" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "verificationStatus" TEXT,
  ADD COLUMN "verificationScore" INTEGER,
  ADD COLUMN "verificationSource" TEXT,
  ADD COLUMN "lastValidatedAt" TIMESTAMP(3),
  ADD COLUMN "relevanceStatus" "ContactRelevanceStatus" NOT NULL DEFAULT 'RELEVANT',
  ADD COLUMN "irrelevanceReason" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_sourceCompanyId_fkey"
  FOREIGN KEY ("sourceCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Contact_userId_source_idx" ON "Contact"("userId", "source");
CREATE INDEX "Contact_userId_verificationState_idx" ON "Contact"("userId", "verificationState");
CREATE INDEX "Contact_userId_relevanceStatus_idx" ON "Contact"("userId", "relevanceStatus");
CREATE INDEX "Contact_sourceCompanyId_idx" ON "Contact"("sourceCompanyId");

CREATE TABLE "ContactQuotaEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "contactId" TEXT,
  "runId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactQuotaEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContactQuotaEvent_operationKey_key" ON "ContactQuotaEvent"("operationKey");
CREATE INDEX "ContactQuotaEvent_organizationId_createdAt_idx" ON "ContactQuotaEvent"("organizationId", "createdAt");
CREATE INDEX "ContactQuotaEvent_userId_createdAt_idx" ON "ContactQuotaEvent"("userId", "createdAt");

CREATE TABLE "ContactRelevanceFeedback" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contactId" TEXT,
  "companyId" TEXT,
  "email" TEXT NOT NULL,
  "reason" TEXT,
  "companySnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactRelevanceFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContactRelevanceFeedback_organizationId_createdAt_idx" ON "ContactRelevanceFeedback"("organizationId", "createdAt");
CREATE INDEX "ContactRelevanceFeedback_companyId_idx" ON "ContactRelevanceFeedback"("companyId");

CREATE TABLE "ProspectingRunIssue" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "companyId" TEXT,
  "stage" TEXT NOT NULL,
  "provider" TEXT,
  "code" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectingRunIssue_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ProspectingRunIssue" ADD CONSTRAINT "ProspectingRunIssue_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ProspectingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ProspectingRunIssue_runId_createdAt_idx" ON "ProspectingRunIssue"("runId", "createdAt");
CREATE INDEX "ProspectingRunIssue_code_idx" ON "ProspectingRunIssue"("code");
