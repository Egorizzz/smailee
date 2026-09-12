ALTER TABLE "Message"
  ADD COLUMN "deliveryKey" TEXT;

ALTER TABLE "ReplyMessage"
  ADD COLUMN "deliveryKey" TEXT;

-- Only unambiguous historical ids become cross-channel delivery keys. If old
-- data contains a duplicate provider id, preserve both records and leave the
-- key empty rather than failing deployment or deleting customer history.
UPDATE "Message" AS message
SET "deliveryKey" = message."messageIdHeader"
WHERE message."messageIdHeader" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Message" AS duplicate
    WHERE duplicate."messageIdHeader" = message."messageIdHeader"
      AND duplicate."id" <> message."id"
  );

UPDATE "ReplyMessage" AS reply
SET "deliveryKey" = reply."providerMessageId"
WHERE reply."providerMessageId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ReplyMessage" AS duplicate
    WHERE duplicate."providerMessageId" = reply."providerMessageId"
      AND duplicate."id" <> reply."id"
  );

CREATE UNIQUE INDEX "Message_deliveryKey_key"
  ON "Message"("deliveryKey");

CREATE UNIQUE INDEX "ReplyMessage_deliveryKey_key"
  ON "ReplyMessage"("deliveryKey");
