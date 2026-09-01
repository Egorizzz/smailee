ALTER TABLE "User"
  ADD COLUMN "login" TEXT,
  ADD COLUMN "emailPending" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

ALTER TYPE "AuthTokenType" ADD VALUE 'INITIAL_ACCESS';
ALTER TYPE "AuthTokenType" ADD VALUE 'CREDENTIAL_CHANGE';

CREATE TABLE "AccountCredentialChange" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "newLogin" TEXT,
  "newPasswordHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountCredentialChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountCredentialChange_userId_key" ON "AccountCredentialChange"("userId");

ALTER TABLE "AccountCredentialChange"
  ADD CONSTRAINT "AccountCredentialChange_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
