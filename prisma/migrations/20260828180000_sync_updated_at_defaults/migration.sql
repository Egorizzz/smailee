-- Keep database defaults aligned with Prisma's @default(now()) declarations.
-- Setting a default is metadata-only and does not rewrite existing rows.
ALTER TABLE "CompanyProspectContact"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "CompanyProspectContactSource"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "CompanySiteIntelligence"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ContactImportItem"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ContactImportJob"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ExternalDataOperation"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ProspectingRun"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ProspectingRunCompany"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
