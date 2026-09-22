ALTER TABLE "ProspectingRun"
  ADD COLUMN "recoveryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "ProspectingRun_status_leaseExpiresAt_idx" ON "ProspectingRun"("status", "leaseExpiresAt");
