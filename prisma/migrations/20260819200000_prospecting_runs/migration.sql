CREATE TYPE "ProspectingRunStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "ProspectingCandidateStatus" AS ENUM ('PENDING', 'PROCESSING', 'ACCEPTED', 'REJECTED', 'FAILED');
CREATE TYPE "EmailVerificationState" AS ENUM ('UNVERIFIED', 'PENDING', 'VALID', 'ACCEPT_ALL', 'UNKNOWN', 'INVALID', 'DISPOSABLE', 'WEBMAIL', 'BLOCKED', 'CLAIMED');

ALTER TABLE "CompanyProspectContact"
  ADD COLUMN "verificationState" "EmailVerificationState" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "verificationScore" INTEGER,
  ADD COLUMN "verificationSource" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3);

CREATE TABLE "CompanyProspectContactSource" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "rawData" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyProspectContactSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectingRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "status" "ProspectingRunStatus" NOT NULL DEFAULT 'DRAFT',
  "query" JSONB NOT NULL,
  "targetCompanies" INTEGER NOT NULL DEFAULT 250,
  "maxCandidates" INTEGER NOT NULL DEFAULT 500,
  "allowAcceptAll" BOOLEAN NOT NULL DEFAULT false,
  "minAcceptAllScore" INTEGER NOT NULL DEFAULT 85,
  "budgets" JSONB NOT NULL DEFAULT '{}',
  "usage" JSONB NOT NULL DEFAULT '{}',
  "selectedCount" INTEGER NOT NULL DEFAULT 0,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "cursor" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProspectingRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectingRunCompany" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "status" "ProspectingCandidateStatus" NOT NULL DEFAULT 'PENDING',
  "selectedContactId" TEXT,
  "rejectionReason" TEXT,
  "error" TEXT,
  "personalizationHooks" JSONB NOT NULL DEFAULT '[]',
  "usage" JSONB NOT NULL DEFAULT '{}',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProspectingRunCompany_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyProspectContactSource_contactId_sourceKey_key" ON "CompanyProspectContactSource"("contactId", "sourceKey");
CREATE INDEX "CompanyProspectContactSource_provider_observedAt_idx" ON "CompanyProspectContactSource"("provider", "observedAt");
CREATE INDEX "ProspectingRun_organizationId_status_idx" ON "ProspectingRun"("organizationId", "status");
CREATE INDEX "ProspectingRun_status_createdAt_idx" ON "ProspectingRun"("status", "createdAt");
CREATE UNIQUE INDEX "ProspectingRunCompany_runId_companyId_key" ON "ProspectingRunCompany"("runId", "companyId");
CREATE UNIQUE INDEX "ProspectingRunCompany_runId_position_key" ON "ProspectingRunCompany"("runId", "position");
CREATE INDEX "ProspectingRunCompany_runId_status_idx" ON "ProspectingRunCompany"("runId", "status");
CREATE INDEX "ProspectingRunCompany_companyId_idx" ON "ProspectingRunCompany"("companyId");

ALTER TABLE "CompanyProspectContactSource" ADD CONSTRAINT "CompanyProspectContactSource_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CompanyProspectContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingRun" ADD CONSTRAINT "ProspectingRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingRun" ADD CONSTRAINT "ProspectingRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingRunCompany" ADD CONSTRAINT "ProspectingRunCompany_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProspectingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingRunCompany" ADD CONSTRAINT "ProspectingRunCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingRunCompany" ADD CONSTRAINT "ProspectingRunCompany_selectedContactId_fkey" FOREIGN KEY ("selectedContactId") REFERENCES "CompanyProspectContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
