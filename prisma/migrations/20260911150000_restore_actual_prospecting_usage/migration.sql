-- Prospecting quota is charged by the actual number of new unique contacts,
-- including contacts returned above the requested target by the last company.
UPDATE "ContactQuotaEvent"
SET "source" = 'AI_SEARCH'
WHERE "source" = 'AI_SEARCH_BONUS';
