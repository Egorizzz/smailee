CREATE TYPE "ReplyMessageKind" AS ENUM ('REPLY', 'AUTO_PING');

ALTER TABLE "ReplyMessage"
ADD COLUMN "kind" "ReplyMessageKind" NOT NULL DEFAULT 'REPLY',
ADD COLUMN "scheduledAt" TIMESTAMP(3);

CREATE INDEX "ReplyMessage_kind_status_scheduledAt_idx"
ON "ReplyMessage"("kind", "status", "scheduledAt");
