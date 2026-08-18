CREATE TYPE "DemoWorkspaceStatus" AS ENUM ('PENDING', 'GENERATING', 'ACTIVE', 'DISABLED', 'FAILED');

CREATE TABLE "DemoWorkspace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "DemoWorkspaceStatus" NOT NULL DEFAULT 'PENDING',
    "websiteUrl" TEXT,
    "scenario" JSONB,
    "initializedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoWorkspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DemoMailbox" (
    "id" TEXT NOT NULL,
    "demoWorkspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "warmupDay" INTEGER NOT NULL DEFAULT 14,
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "coldSentToday" INTEGER NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoMailbox_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Contact" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN "demoAudienceSize" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN "demoGeneratedCount" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN "demoStats" JSONB;

CREATE UNIQUE INDEX "DemoWorkspace_organizationId_key" ON "DemoWorkspace"("organizationId");
CREATE INDEX "DemoWorkspace_status_idx" ON "DemoWorkspace"("status");
CREATE UNIQUE INDEX "DemoMailbox_demoWorkspaceId_email_key" ON "DemoMailbox"("demoWorkspaceId", "email");
CREATE INDEX "DemoMailbox_demoWorkspaceId_idx" ON "DemoMailbox"("demoWorkspaceId");
CREATE INDEX "Campaign_isDemo_status_idx" ON "Campaign"("isDemo", "status");

ALTER TABLE "DemoWorkspace" ADD CONSTRAINT "DemoWorkspace_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemoMailbox" ADD CONSTRAINT "DemoMailbox_demoWorkspaceId_fkey"
  FOREIGN KEY ("demoWorkspaceId") REFERENCES "DemoWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
