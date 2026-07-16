-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CLIENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('TRIAL', 'START', 'PRO');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "WarmupEventStatus" AS ENUM ('sent', 'delivered', 'opened', 'replied', 'rescued_from_spam', 'failed');

-- CreateEnum
CREATE TYPE "MailProvider" AS ENUM ('yandex', 'google', 'other', 'custom');

-- CreateEnum
CREATE TYPE "MailSecurity" AS ENUM ('SSL', 'STARTTLS');

-- CreateEnum
CREATE TYPE "WarmupState" AS ENUM ('off', 'warming', 'warm');

-- CreateEnum
CREATE TYPE "MailboxConnState" AS ENUM ('ok', 'auth_error', 'unreachable', 'paused', 'disabled');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'BOUNCED', 'UNSUBSCRIBED', 'INVALID', 'COMPLAINED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'QUEUED', 'SENDING', 'SENT', 'PAUSED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'REPLIED', 'BOUNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReplyMessageStatus" AS ENUM ('DRAFT', 'SENT');

-- CreateEnum
CREATE TYPE "LeadQualification" AS ENUM ('HOT', 'COLD', 'IRRELEVANT', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "companyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "UserRole" NOT NULL DEFAULT 'CLIENT',
    "plan" "Plan" NOT NULL DEFAULT 'TRIAL',
    "planExpiresAt" TIMESTAMP(3),
    "acceptedTermsAt" TIMESTAMP(3),
    "websiteUrl" TEXT,
    "offer" TEXT,
    "targetAudience" TEXT,
    "aiModerationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "setupClosedAt" TIMESTAMP(3),
    "brandColor" TEXT,
    "brandLogoUrl" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "amount" INTEGER NOT NULL,
    "plan" "Plan" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "provider" "MailProvider" NOT NULL DEFAULT 'yandex',
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL,
    "smtpSecurity" "MailSecurity" NOT NULL DEFAULT 'SSL',
    "smtpLogin" TEXT NOT NULL,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL,
    "imapSecurity" "MailSecurity" NOT NULL DEFAULT 'SSL',
    "imapLogin" TEXT NOT NULL,
    "smtpPasswordEnc" TEXT NOT NULL,
    "imapPasswordEnc" TEXT NOT NULL,
    "domainGroupId" TEXT NOT NULL,
    "coldDailyLimit" INTEGER NOT NULL DEFAULT 30,
    "coldSentToday" INTEGER NOT NULL DEFAULT 0,
    "coldSentDate" TIMESTAMP(3),
    "warmupSentToday" INTEGER NOT NULL DEFAULT 0,
    "warmupSentDate" TIMESTAMP(3),
    "warmupDay" INTEGER NOT NULL DEFAULT 0,
    "warmupState" "WarmupState" NOT NULL DEFAULT 'off',
    "warmupStartedAt" TIMESTAMP(3),
    "isSeed" BOOLEAN NOT NULL DEFAULT false,
    "spamFolder" TEXT NOT NULL DEFAULT 'Спам',
    "connState" "MailboxConnState" NOT NULL DEFAULT 'paused',
    "connError" TEXT,
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "pausedReason" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imapUidValidity" INTEGER,
    "imapLastUid" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "dailyLimit" INTEGER NOT NULL DEFAULT 120,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "sentTodayDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmupEvent" (
    "id" TEXT NOT NULL,
    "senderMailboxId" TEXT NOT NULL,
    "recipientMailboxId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "WarmupEventStatus" NOT NULL DEFAULT 'sent',
    "messageIdHeader" TEXT,
    "recipientUid" INTEGER,
    "repliedToCode" TEXT,
    "corpusNodeId" TEXT,
    "hop" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "rescuedAt" TIMESTAMP(3),

    CONSTRAINT "WarmupEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "segment" TEXT,
    "meta" JSONB,
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailValid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isHtml" BOOLEAN NOT NULL DEFAULT false,
    "subjectB" TEXT,
    "bodyB" TEXT,
    "abEnabled" BOOLEAN NOT NULL DEFAULT false,
    "segment" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "launchAfterWarmup" BOOLEAN NOT NULL DEFAULT false,
    "followupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "followupDays" INTEGER NOT NULL DEFAULT 3,
    "followupSubject" TEXT,
    "followupBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isHtml" BOOLEAN NOT NULL DEFAULT false,
    "variant" TEXT NOT NULL DEFAULT 'A',
    "step" INTEGER NOT NULL DEFAULT 0,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "followupSentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mailboxId" TEXT,
    "messageIdHeader" TEXT,
    "inReplyTo" TEXT,
    "threadRefs" TEXT,
    "threadAddress" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "subject" TEXT,
    "fromEmail" TEXT,
    "toEmail" TEXT,
    "body" TEXT NOT NULL,
    "isAi" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReplyMessageStatus" NOT NULL DEFAULT 'SENT',
    "externalMessageId" TEXT,
    "providerMessageId" TEXT,

    CONSTRAINT "ReplyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "qualification" "LeadQualification" NOT NULL DEFAULT 'UNKNOWN',
    "summary" TEXT,
    "pushedToCrm" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "preferredTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "messenger" TEXT,
    "company" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandingLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_externalId_idx" ON "Payment"("externalId");

-- CreateIndex
CREATE INDEX "Mailbox_domainGroupId_idx" ON "Mailbox"("domainGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_userId_email_key" ON "Mailbox"("userId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "DomainGroup_userId_domain_key" ON "DomainGroup"("userId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "WarmupEvent_code_key" ON "WarmupEvent"("code");

-- CreateIndex
CREATE INDEX "WarmupEvent_senderMailboxId_idx" ON "WarmupEvent"("senderMailboxId");

-- CreateIndex
CREATE INDEX "WarmupEvent_recipientMailboxId_idx" ON "WarmupEvent"("recipientMailboxId");

-- CreateIndex
CREATE INDEX "WarmupEvent_status_idx" ON "WarmupEvent"("status");

-- CreateIndex
CREATE INDEX "Contact_userId_segment_idx" ON "Contact"("userId", "segment");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_userId_email_key" ON "Contact"("userId", "email");

-- CreateIndex
CREATE INDEX "EmailTemplate_userId_idx" ON "EmailTemplate"("userId");

-- CreateIndex
CREATE INDEX "Message_campaignId_status_idx" ON "Message"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Message_mailboxId_idx" ON "Message"("mailboxId");

-- CreateIndex
CREATE INDEX "Event_messageId_type_idx" ON "Event"("messageId", "type");

-- CreateIndex
CREATE INDEX "ReplyMessage_messageId_idx" ON "ReplyMessage"("messageId");

-- CreateIndex
CREATE INDEX "ReplyMessage_externalMessageId_idx" ON "ReplyMessage"("externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_messageId_key" ON "Lead"("messageId");

-- CreateIndex
CREATE INDEX "Lead_userId_qualification_idx" ON "Lead"("userId", "qualification");

-- CreateIndex
CREATE INDEX "Suppression_userId_idx" ON "Suppression"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_userId_email_key" ON "Suppression"("userId", "email");

-- CreateIndex
CREATE INDEX "SetupRequest_userId_idx" ON "SetupRequest"("userId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_domainGroupId_fkey" FOREIGN KEY ("domainGroupId") REFERENCES "DomainGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainGroup" ADD CONSTRAINT "DomainGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmupEvent" ADD CONSTRAINT "WarmupEvent_senderMailboxId_fkey" FOREIGN KEY ("senderMailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmupEvent" ADD CONSTRAINT "WarmupEvent_recipientMailboxId_fkey" FOREIGN KEY ("recipientMailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyMessage" ADD CONSTRAINT "ReplyMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupRequest" ADD CONSTRAINT "SetupRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

