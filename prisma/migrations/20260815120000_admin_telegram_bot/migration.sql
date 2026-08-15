ALTER TYPE "AuthTokenType" ADD VALUE 'ADMIN_TELEGRAM_CONNECT';

CREATE TABLE "AdminTelegramRecipient" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "telegramName" TEXT,
    "invitedById" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminTelegramRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminTelegramDelivery" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "buttonText" TEXT,
    "buttonUrl" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminTelegramDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminTelegramRecipient_chatId_key" ON "AdminTelegramRecipient"("chatId");
CREATE INDEX "AdminTelegramRecipient_revokedAt_connectedAt_idx" ON "AdminTelegramRecipient"("revokedAt", "connectedAt");
CREATE INDEX "AdminTelegramDelivery_sentAt_discardedAt_nextAttemptAt_idx" ON "AdminTelegramDelivery"("sentAt", "discardedAt", "nextAttemptAt");
CREATE INDEX "AdminTelegramDelivery_recipientId_createdAt_idx" ON "AdminTelegramDelivery"("recipientId", "createdAt");

ALTER TABLE "AdminTelegramRecipient"
ADD CONSTRAINT "AdminTelegramRecipient_invitedById_fkey"
FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminTelegramDelivery"
ADD CONSTRAINT "AdminTelegramDelivery_recipientId_fkey"
FOREIGN KEY ("recipientId") REFERENCES "AdminTelegramRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
