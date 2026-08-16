ALTER TABLE "User"
ADD COLUMN "autoPingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoPingIntervalDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN "autoPingMaxAttempts" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "Message"
ADD COLUMN "aiRepliesEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "refusalSuggestedAt" TIMESTAMP(3),
ADD COLUMN "refusedAt" TIMESTAMP(3),
ADD COLUMN "nextContactAt" TIMESTAMP(3),
ADD COLUMN "autoPingEnabled" BOOLEAN,
ADD COLUMN "autoPingIntervalDays" INTEGER,
ADD COLUMN "autoPingMaxAttempts" INTEGER,
ADD COLUMN "autoPingAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "autoPingNextAt" TIMESTAMP(3),
ADD COLUMN "autoPingLastSentAt" TIMESTAMP(3),
ADD COLUMN "autoPingStoppedAt" TIMESTAMP(3);

CREATE INDEX "Message_autoPingNextAt_idx" ON "Message"("autoPingNextAt");
CREATE INDEX "Message_refusedAt_refusalSuggestedAt_idx" ON "Message"("refusedAt", "refusalSuggestedAt");
