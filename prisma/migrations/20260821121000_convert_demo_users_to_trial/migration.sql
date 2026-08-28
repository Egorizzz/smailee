-- Production data migration: replace the former time-limited account demo
-- with the indefinite trial plan. Virtual demo data is retained but disabled.
WITH converted AS (
  UPDATE "User"
  SET
    "plan" = 'TRIAL'::"Plan",
    "planExpiresAt" = NULL,
    "isDemo" = false,
    "demoUsedAt" = NULL
  WHERE "isDemo" = true
  RETURNING "organizationId"
)
UPDATE "DemoWorkspace"
SET "status" = 'DISABLED'::"DemoWorkspaceStatus", "updatedAt" = NOW()
WHERE "organizationId" IN (
  SELECT "organizationId" FROM converted WHERE "organizationId" IS NOT NULL
);
