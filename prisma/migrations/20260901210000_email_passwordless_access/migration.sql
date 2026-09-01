ALTER TYPE "AuthTokenType" ADD VALUE 'EMAIL_LOGIN';
ALTER TYPE "AuthTokenType" ADD VALUE 'EMAIL_CHANGE';

ALTER TABLE "User"
  ADD COLUMN "passwordEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

UPDATE "User"
SET "emailVerifiedAt" = "createdAt"
WHERE "emailPending" = false
  AND "email" NOT LIKE '%@pending.smailee.invalid';

ALTER TABLE "AuthToken"
  ADD COLUMN "verifiesEmail" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AccountCredentialChange"
  DROP COLUMN "newLogin";

CREATE TABLE "AccountEmailChange" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "newEmail" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountEmailChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountEmailChange_userId_key" ON "AccountEmailChange"("userId");
CREATE UNIQUE INDEX "AccountEmailChange_newEmail_key" ON "AccountEmailChange"("newEmail");

ALTER TABLE "AccountEmailChange"
  ADD CONSTRAINT "AccountEmailChange_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LandingLead"
  ADD COLUMN "website" TEXT;
