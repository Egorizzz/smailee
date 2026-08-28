CREATE TYPE "ContactImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "ContactImportItemStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "ContactImportJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "status" "ContactImportStatus" NOT NULL DEFAULT 'QUEUED',
  "sourceRows" INTEGER NOT NULL,
  "totalContacts" INTEGER NOT NULL,
  "prevalidatedContacts" INTEGER NOT NULL DEFAULT 0,
  "processedContacts" INTEGER NOT NULL DEFAULT 0,
  "invalidContacts" INTEGER NOT NULL DEFAULT 0,
  "siteAnalyzedContacts" INTEGER NOT NULL DEFAULT 0,
  "issueCount" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactImportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactImportItem" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "ContactImportItemStatus" NOT NULL DEFAULT 'PENDING',
  "claimId" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactImportItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactImportJob_status_createdAt_idx" ON "ContactImportJob"("status", "createdAt");
CREATE INDEX "ContactImportJob_organizationId_createdAt_idx" ON "ContactImportJob"("organizationId", "createdAt");
CREATE UNIQUE INDEX "ContactImportItem_jobId_email_key" ON "ContactImportItem"("jobId", "email");
CREATE INDEX "ContactImportItem_jobId_status_idx" ON "ContactImportItem"("jobId", "status");
ALTER TABLE "ContactImportItem" ADD CONSTRAINT "ContactImportItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ContactImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
