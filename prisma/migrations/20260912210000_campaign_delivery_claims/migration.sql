ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'SENDING' AFTER 'QUEUED';
ALTER TYPE "ReplyMessageStatus" ADD VALUE IF NOT EXISTS 'SENDING' AFTER 'DRAFT';

ALTER TABLE "Message"
  ADD COLUMN "deliveryClaimedAt" TIMESTAMP(3);

ALTER TABLE "ReplyMessage"
  ADD COLUMN "deliveryClaimedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryError" TEXT;

-- Historical duplicate rows are preserved, but only the earliest keeps the
-- provider message id used for idempotency. PostgreSQL permits multiple NULLs
-- in a unique index, so no conversation content is removed.
WITH ranked_replies AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "messageId", "externalMessageId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS duplicate_rank
  FROM "ReplyMessage"
  WHERE "externalMessageId" IS NOT NULL
)
UPDATE "ReplyMessage" AS reply
SET "externalMessageId" = NULL
FROM ranked_replies
WHERE reply."id" = ranked_replies."id"
  AND ranked_replies.duplicate_rank > 1;

CREATE UNIQUE INDEX "ReplyMessage_messageId_externalMessageId_key"
  ON "ReplyMessage"("messageId", "externalMessageId");
