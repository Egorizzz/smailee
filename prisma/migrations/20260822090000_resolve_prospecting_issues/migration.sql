ALTER TABLE "ProspectingRunIssue" ADD COLUMN "resolvedAt" TIMESTAMP(3);

CREATE INDEX "ProspectingRunIssue_runId_resolvedAt_idx"
ON "ProspectingRunIssue"("runId", "resolvedAt");
