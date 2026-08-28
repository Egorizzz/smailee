ALTER TABLE "ProspectingRun" ADD COLUMN "targetContacts" INTEGER NOT NULL DEFAULT 500;

CREATE TABLE "ProspectingRunContact" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectingRunContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProspectingRunContact_runId_contactId_key" ON "ProspectingRunContact"("runId", "contactId");
CREATE INDEX "ProspectingRunContact_runId_companyId_idx" ON "ProspectingRunContact"("runId", "companyId");
ALTER TABLE "ProspectingRunContact" ADD CONSTRAINT "ProspectingRunContact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProspectingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingRunContact" ADD CONSTRAINT "ProspectingRunContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingRunContact" ADD CONSTRAINT "ProspectingRunContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CompanyProspectContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ExternalDataOperation" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "requests" INTEGER NOT NULL DEFAULT 0,
  "credits" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalDataOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalDataOperation_operationKey_key" ON "ExternalDataOperation"("operationKey");
CREATE INDEX "ExternalDataOperation_provider_operation_expiresAt_idx" ON "ExternalDataOperation"("provider", "operation", "expiresAt");
