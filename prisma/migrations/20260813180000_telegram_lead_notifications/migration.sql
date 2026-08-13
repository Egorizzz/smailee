ALTER TABLE "User"
ADD COLUMN "telegramChatId" TEXT,
ADD COLUMN "telegramUsername" TEXT,
ADD COLUMN "telegramConnectedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");

ALTER TYPE "AuthTokenType" ADD VALUE 'TELEGRAM_CONNECT';
