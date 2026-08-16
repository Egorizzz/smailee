ALTER TABLE "OrganizationProfile" ADD COLUMN "manualData" JSONB;

-- Separate administrator-confirmed inputs from AI-generated draft facts. Existing
-- owner fields are retained as a one-time compatibility import only.
UPDATE "OrganizationProfile" p
SET "manualData" = jsonb_build_object(
  'schemaVersion', 1,
  'companyName', u."companyName",
  'websiteUrl', u."websiteUrl",
  'summary', '',
  'offers', CASE WHEN u."offer" IS NULL OR u."offer" = '' THEN '[]'::jsonb ELSE jsonb_build_array(u."offer") END,
  'products', '[]'::jsonb,
  'targetAudiences', CASE WHEN u."targetAudience" IS NULL OR u."targetAudience" = '' THEN '[]'::jsonb ELSE jsonb_build_array(u."targetAudience") END,
  'painPoints', '[]'::jsonb,
  'differentiators', '[]'::jsonb,
  'proof', '[]'::jsonb,
  'geography', '[]'::jsonb,
  'salesProcess', '[]'::jsonb,
  'restrictions', '[]'::jsonb,
  'tone', '',
  'manualNotes', COALESCE(p."draftData" ->> 'manualNotes', ''),
  'unknowns', '[]'::jsonb,
  'sources', '[]'::jsonb
)
FROM "Organization" o
JOIN "User" u ON u."id" = o."ownerId"
WHERE p."organizationId" = o."id";
