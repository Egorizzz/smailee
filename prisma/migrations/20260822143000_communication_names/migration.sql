ALTER TABLE "Company"
  ADD COLUMN "communicationName" TEXT,
  ADD COLUMN "communicationNameConfidence" DOUBLE PRECISION,
  ADD COLUMN "communicationNameSource" TEXT,
  ADD COLUMN "communicationNameEvidence" TEXT,
  ADD COLUMN "communicationNameUpdatedAt" TIMESTAMP(3);

ALTER TABLE "Contact"
  ADD COLUMN "communicationNameOverride" TEXT;
