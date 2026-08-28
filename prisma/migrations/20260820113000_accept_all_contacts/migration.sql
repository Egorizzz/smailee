ALTER TABLE "ProspectingRun"
  ALTER COLUMN "allowAcceptAll" SET DEFAULT true,
  ALTER COLUMN "minAcceptAllScore" SET DEFAULT 0;

UPDATE "ProspectingRun"
SET "allowAcceptAll" = true,
    "minAcceptAllScore" = 0;
