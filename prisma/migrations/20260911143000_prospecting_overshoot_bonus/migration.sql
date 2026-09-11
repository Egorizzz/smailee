-- Contacts returned beyond a prospecting run's requested target are retained,
-- but must not consume the organization's search quota.
WITH ranked_events AS (
  SELECT
    event."id",
    ROW_NUMBER() OVER (
      PARTITION BY event."runId"
      ORDER BY event."createdAt" ASC, event."id" ASC
    ) AS position,
    run."targetContacts"
  FROM "ContactQuotaEvent" AS event
  INNER JOIN "ProspectingRun" AS run ON run."id" = event."runId"
  WHERE event."source" = 'AI_SEARCH'
    AND event."runId" IS NOT NULL
)
UPDATE "ContactQuotaEvent" AS event
SET "source" = 'AI_SEARCH_BONUS'
FROM ranked_events
WHERE event."id" = ranked_events."id"
  AND ranked_events.position > ranked_events."targetContacts";
