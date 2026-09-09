ALTER TABLE "User"
ADD COLUMN "setupReviewedContactsAt" TIMESTAMP(3);

UPDATE "User"
SET "setupSkippedSteps" = COALESCE((
  SELECT array_agg(CASE WHEN step >= 3 THEN step + 1 ELSE step END ORDER BY step)
  FROM unnest("setupSkippedSteps") AS step
), ARRAY[]::INTEGER[]);
