ALTER TABLE "Campaign" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "processedAt" TIMESTAMP(3);

CREATE INDEX "Lead_userId_processedAt_idx" ON "Lead"("userId", "processedAt");
