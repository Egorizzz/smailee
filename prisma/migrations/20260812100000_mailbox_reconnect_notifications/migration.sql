CREATE TYPE "MailboxPauseKind" AS ENUM ('MANUAL', 'AUTH', 'NETWORK', 'DELIVERY_FAILURES');

ALTER TABLE "Mailbox"
ADD COLUMN "pauseKind" "MailboxPauseKind",
ADD COLUMN "connectionIncidentAt" TIMESTAMP(3),
ADD COLUMN "reconnectAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextReconnectAt" TIMESTAMP(3);

CREATE INDEX "Mailbox_connState_pauseKind_nextReconnectAt_idx"
ON "Mailbox"("connState", "pauseKind", "nextReconnectAt");

CREATE TABLE "AdminNotification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "recipientEmails" TEXT[] NOT NULL,
  "subject" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminNotification_dedupeKey_key" ON "AdminNotification"("dedupeKey");
CREATE INDEX "AdminNotification_sentAt_nextAttemptAt_idx" ON "AdminNotification"("sentAt", "nextAttemptAt");
CREATE INDEX "AdminNotification_userId_createdAt_idx" ON "AdminNotification"("userId", "createdAt");

ALTER TABLE "AdminNotification"
ADD CONSTRAINT "AdminNotification_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
