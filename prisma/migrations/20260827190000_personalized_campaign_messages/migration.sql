-- Existing messages retain their already approved/materialized copy. New
-- messages must be personalized before the send engine may claim them.
CREATE TYPE "MessagePersonalizationStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

ALTER TABLE "Message"
  ADD COLUMN "personalizationStatus" "MessagePersonalizationStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "personalizationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "personalizationError" TEXT,
  ADD COLUMN "personalizationContextHash" TEXT,
  ADD COLUMN "personalizationMeta" JSONB,
  ADD COLUMN "personalizationClaimedAt" TIMESTAMP(3),
  ADD COLUMN "personalizationNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "personalizedAt" TIMESTAMP(3);

ALTER TABLE "Message" ALTER COLUMN "personalizationStatus" SET DEFAULT 'PENDING';

CREATE INDEX "Message_campaignId_personalizationStatus_status_idx"
  ON "Message"("campaignId", "personalizationStatus", "status");
