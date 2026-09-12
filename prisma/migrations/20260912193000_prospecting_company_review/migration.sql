CREATE TYPE "ProspectingReviewDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "ProspectingRun"
ADD COLUMN "reviewPreparedAt" TIMESTAMP(3),
ADD COLUMN "reviewCompletedAt" TIMESTAMP(3),
ADD COLUMN "reviewSkippedAt" TIMESTAMP(3);

ALTER TABLE "ProspectingRunCompany"
ADD COLUMN "reviewDecision" "ProspectingReviewDecision" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "reviewReason" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "ProspectingRunCompany_runId_reviewDecision_idx"
ON "ProspectingRunCompany"("runId", "reviewDecision");
