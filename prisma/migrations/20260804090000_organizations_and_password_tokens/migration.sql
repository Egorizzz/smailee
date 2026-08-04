-- Shared company workspace, membership and secure one-time password links.
CREATE TYPE "OrganizationRole" AS ENUM ('ORG_ADMIN', 'MEMBER');
CREATE TYPE "OrganizationPermission" AS ENUM (
    'CONTACTS_VIEW', 'CONTACTS_MANAGE', 'CAMPAIGNS_VIEW_ALL', 'CAMPAIGNS_CREATE',
    'CAMPAIGNS_MANAGE_OWN', 'CAMPAIGNS_MANAGE_ALL', 'STATS_VIEW_ALL', 'LEADS_VIEW_ALL',
    'LEADS_REPLY_OWN', 'LEADS_REPLY_ALL', 'INFRASTRUCTURE_MANAGE', 'BILLING_MANAGE'
);
CREATE TYPE "AuthTokenType" AS ENUM ('INVITE', 'PASSWORD_RESET');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User"
    ADD COLUMN "organizationId" TEXT,
    ADD COLUMN "organizationRole" "OrganizationRole" NOT NULL DEFAULT 'ORG_ADMIN',
    ADD COLUMN "organizationPermissions" "OrganizationPermission"[] NOT NULL DEFAULT ARRAY[]::"OrganizationPermission"[];

ALTER TABLE "Campaign" ADD COLUMN "createdById" TEXT;

CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- Every existing personal account becomes an organization owned by that user.
-- All current business rows keep their userId, so no customer data is moved.
INSERT INTO "Organization" ("id", "name", "ownerId")
SELECT 'org_' || md5("id"), COALESCE(NULLIF("companyName", ''), "email"), "id"
FROM "User";

UPDATE "User" u
SET "organizationId" = o."id", "organizationRole" = 'ORG_ADMIN'
FROM "Organization" o
WHERE o."ownerId" = u."id";

CREATE UNIQUE INDEX "Organization_ownerId_key" ON "Organization"("ownerId");
CREATE INDEX "Organization_ownerId_idx" ON "Organization"("ownerId");
CREATE INDEX "Campaign_createdById_idx" ON "Campaign"("createdById");
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_userId_type_expiresAt_idx" ON "AuthToken"("userId", "type", "expiresAt");

ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
