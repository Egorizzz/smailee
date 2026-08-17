-- CreateEnum
CREATE TYPE "CustomerNotificationScope" AS ENUM ('OWN', 'ALL');

-- CreateEnum
CREATE TYPE "CustomerNotificationMode" AS ENUM ('OFF', 'IMMEDIATE', 'GROUPED');

-- CreateEnum
CREATE TYPE "ReplyNotificationPolicy" AS ENUM ('ACTION_REQUIRED', 'ALL');

-- CreateEnum
CREATE TYPE "CustomerDigestFrequency" AS ENUM ('EVERY_15_MINUTES', 'HOURLY', 'DAILY');

-- CreateEnum
CREATE TYPE "CustomerNotificationCategory" AS ENUM ('REPLY', 'WARM_LEAD');

-- CreateEnum
CREATE TYPE "CustomerNotificationChannel" AS ENUM ('TELEGRAM', 'EMAIL');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "customerNotificationScope" "CustomerNotificationScope" NOT NULL DEFAULT 'OWN',
ADD COLUMN "replyNotificationPolicy" "ReplyNotificationPolicy" NOT NULL DEFAULT 'ACTION_REQUIRED',
ADD COLUMN "telegramReplyMode" "CustomerNotificationMode" NOT NULL DEFAULT 'IMMEDIATE',
ADD COLUMN "telegramWarmLeadMode" "CustomerNotificationMode" NOT NULL DEFAULT 'IMMEDIATE',
ADD COLUMN "telegramGroupMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN "emailDigestReplies" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "emailDigestWarmLeads" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "emailDigestFrequency" "CustomerDigestFrequency" NOT NULL DEFAULT 'HOURLY',
ADD COLUMN "emailDigestHourMsk" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "CustomerNotificationDelivery" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "sourceReplyId" TEXT NOT NULL,
    "category" "CustomerNotificationCategory" NOT NULL,
    "channel" "CustomerNotificationChannel" NOT NULL,
    "deliverAfter" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerNotificationDelivery_recipientId_sourceReplyId_channel_key" ON "CustomerNotificationDelivery"("recipientId", "sourceReplyId", "channel");

-- CreateIndex
CREATE INDEX "CustomerNotificationDelivery_channel_sentAt_canceledAt_deliverAfter_nextAttemptAt_idx" ON "CustomerNotificationDelivery"("channel", "sentAt", "canceledAt", "deliverAfter", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CustomerNotificationDelivery_recipientId_category_sentAt_idx" ON "CustomerNotificationDelivery"("recipientId", "category", "sentAt");

-- AddForeignKey
ALTER TABLE "CustomerNotificationDelivery" ADD CONSTRAINT "CustomerNotificationDelivery_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotificationDelivery" ADD CONSTRAINT "CustomerNotificationDelivery_sourceReplyId_fkey" FOREIGN KEY ("sourceReplyId") REFERENCES "ReplyMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
