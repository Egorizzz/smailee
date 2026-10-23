-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "nextCampaignSendAt" TIMESTAMP(3),
ADD COLUMN     "smtpBlockedUntil" TIMESTAMP(3),
ADD COLUMN     "spamRejectionsSinceWarmup" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DomainGroup" ADD COLUMN     "nextCampaignSendAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "plannedCompletionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deliveryIssue" TEXT,
ADD COLUMN     "deliveryIssueAt" TIMESTAMP(3),
ADD COLUMN     "plannedMailboxId" TEXT,
ADD COLUMN     "plannedSendAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "externalKey" TEXT;

-- CreateTable
CREATE TABLE "CampaignMailboxState" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "spamRejections" INTEGER NOT NULL DEFAULT 0,
    "excludedAt" TIMESTAMP(3),
    "resumedAt" TIMESTAMP(3),
    "notificationSentAt" TIMESTAMP(3),
    "notificationClaimedAt" TIMESTAMP(3),
    "notificationNextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignMailboxState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxReportCursor" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "uidValidity" TEXT NOT NULL,
    "lastUid" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MailboxReportCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxDeliveryReport" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxDeliveryReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMailboxState_campaignId_mailboxId_key" ON "CampaignMailboxState"("campaignId", "mailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxReportCursor_mailboxId_folder_key" ON "MailboxReportCursor"("mailboxId", "folder");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxDeliveryReport_externalKey_key" ON "MailboxDeliveryReport"("externalKey");

-- CreateIndex
CREATE INDEX "Message_plannedSendAt_status_idx" ON "Message"("plannedSendAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Event_externalKey_key" ON "Event"("externalKey");

-- AddForeignKey
ALTER TABLE "CampaignMailboxState" ADD CONSTRAINT "CampaignMailboxState_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMailboxState" ADD CONSTRAINT "CampaignMailboxState_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxReportCursor" ADD CONSTRAINT "MailboxReportCursor_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxDeliveryReport" ADD CONSTRAINT "MailboxDeliveryReport_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Repair only explicit SMTP spam rejections. Unknown network outcomes stay SENDING.
UPDATE "Message"
SET "deliveryIssue" = 'SPAM_REJECTED',
    "deliveryIssueAt" = COALESCE("deliveryClaimedAt", "createdAt"),
    "status" = CASE WHEN "sentAt" IS NULL AND "status" = 'SENDING'
                    THEN 'FAILED'::"MessageStatus" ELSE "status" END
WHERE "error" ~* 'Message failed: 5[0-9]{2}.*spam';

INSERT INTO "Event" ("id", "messageId", "type", "payload", "externalKey", "createdAt")
SELECT 'delivery-legacy-' || "id", "id", 'smtp',
       jsonb_build_object('source', 'SMTP', 'legacy', true, 'diagnostic', "error"),
       'legacy-smtp:' || "id", "deliveryIssueAt"
FROM "Message" WHERE "deliveryIssue" = 'SPAM_REJECTED'
ON CONFLICT DO NOTHING;

INSERT INTO "Suppression" ("id", "userId", "email", "reason", "createdAt")
SELECT DISTINCT ON (c."userId", ct."email")
       'delivery-block-' || m."id", c."userId", ct."email", 'spam_rejected', m."deliveryIssueAt"
FROM "Message" m JOIN "Campaign" c ON c."id" = m."campaignId"
JOIN "Contact" ct ON ct."id" = m."contactId"
WHERE m."deliveryIssue" = 'SPAM_REJECTED' AND NOT c."isDemo"
ORDER BY c."userId", ct."email", m."deliveryIssueAt" DESC
ON CONFLICT ("userId", "email") DO NOTHING;

INSERT INTO "CampaignMailboxState" ("id", "campaignId", "mailboxId", "spamRejections")
SELECT 'delivery-state-' || MIN("id"), "campaignId", "mailboxId", COUNT(*)::integer
FROM "Message" WHERE "deliveryIssue" = 'SPAM_REJECTED' AND "mailboxId" IS NOT NULL
GROUP BY "campaignId", "mailboxId";

UPDATE "Mailbox" b SET "spamRejectionsSinceWarmup" = counts.n
FROM (SELECT "mailboxId", COUNT(*)::integer n FROM "Message"
      WHERE "deliveryIssue" = 'SPAM_REJECTED' AND "mailboxId" IS NOT NULL GROUP BY "mailboxId") counts
WHERE b."id" = counts."mailboxId";
