ALTER TYPE "OrganizationPermission" ADD VALUE IF NOT EXISTS 'CAMPAIGN_RECIPIENTS_VIEW';

CREATE TABLE "SystemApiIncident" (
  "id" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "SystemApiIncident_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SystemApiIncident_service_key" ON "SystemApiIncident"("service");
