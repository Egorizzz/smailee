-- Draft/queued real campaigns created before recipient-level generation must
-- also receive final copy per contact. Sent history and demo examples remain
-- immutable.
UPDATE "Message" AS m
SET "personalizationStatus" = 'PENDING',
    "personalizationAttempts" = 0,
    "personalizationError" = NULL,
    "personalizationClaimedAt" = NULL,
    "personalizationNextAttemptAt" = NULL
FROM "Campaign" AS c
WHERE c.id = m."campaignId"
  AND c."isDemo" = false
  AND m.status = 'PENDING'
  AND m."personalizedAt" IS NULL;
