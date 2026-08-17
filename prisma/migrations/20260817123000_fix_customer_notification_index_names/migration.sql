-- PostgreSQL silently truncates identifiers longer than 63 bytes. The first
-- customer-notification migration therefore created these two indexes with
-- truncated names, while Prisma's naming convention shortens the field part
-- and preserves the `_key` / `_idx` suffix. Rename them explicitly so
-- migration history and schema.prisma describe the same database.

ALTER INDEX "CustomerNotificationDelivery_recipientId_sourceReplyId_channel_"
RENAME TO "CustomerNotificationDelivery_recipientId_sourceReplyId_chan_key";

ALTER INDEX "CustomerNotificationDelivery_channel_sentAt_canceledAt_deliverA"
RENAME TO "CustomerNotificationDelivery_channel_sentAt_canceledAt_deli_idx";
