-- Organization-level business knowledge assembled from manual input and website crawls.
CREATE TYPE "WebsiteCrawlStatus" AS ENUM (
  'PENDING', 'CRAWLING', 'ANALYZING', 'READY_FOR_REVIEW', 'FAILED', 'CANCELED'
);
CREATE TYPE "WebsitePageAnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');
CREATE TYPE "ProfileQuestionStatus" AS ENUM ('OPEN', 'ANSWERED', 'DISMISSED');

CREATE TABLE "OrganizationProfile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "draftData" JSONB,
  "publishedData" JSONB,
  "publishedAt" TIMESTAMP(3),
  "staleAt" TIMESTAMP(3),
  "sourceCrawlId" TEXT,
  "publishedSourceCrawlId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationProfileSnapshot" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "data" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationProfileSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebsiteCrawl" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'firecrawl',
  "providerJobId" TEXT,
  "rootUrl" TEXT NOT NULL,
  "status" "WebsiteCrawlStatus" NOT NULL DEFAULT 'PENDING',
  "pageLimit" INTEGER NOT NULL DEFAULT 50,
  "maxDepth" INTEGER NOT NULL DEFAULT 3,
  "includePaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "excludePaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowSubdomains" BOOLEAN NOT NULL DEFAULT false,
  "discoveredCount" INTEGER NOT NULL DEFAULT 0,
  "crawledCount" INTEGER NOT NULL DEFAULT 0,
  "analyzedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "creditsUsed" INTEGER,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextPollAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteCrawl_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebsitePage" (
  "id" TEXT NOT NULL,
  "crawlId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "title" TEXT,
  "description" TEXT,
  "contentType" TEXT,
  "statusCode" INTEGER,
  "markdown" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "analysis" JSONB,
  "analysisStatus" "WebsitePageAnalysisStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsitePage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebsiteCrawlWebhookEvent" (
  "id" TEXT NOT NULL,
  "crawlId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteCrawlWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfileQuestion" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "reason" TEXT,
  "critical" BOOLEAN NOT NULL DEFAULT false,
  "status" "ProfileQuestionStatus" NOT NULL DEFAULT 'OPEN',
  "answer" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfileQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationProfile_organizationId_key" ON "OrganizationProfile"("organizationId");
CREATE INDEX "OrganizationProfile_staleAt_idx" ON "OrganizationProfile"("staleAt");
CREATE UNIQUE INDEX "OrganizationProfileSnapshot_profileId_version_key" ON "OrganizationProfileSnapshot"("profileId", "version");
CREATE INDEX "OrganizationProfileSnapshot_profileId_createdAt_idx" ON "OrganizationProfileSnapshot"("profileId", "createdAt");
CREATE UNIQUE INDEX "WebsiteCrawl_providerJobId_key" ON "WebsiteCrawl"("providerJobId");
CREATE INDEX "WebsiteCrawl_organizationId_createdAt_idx" ON "WebsiteCrawl"("organizationId", "createdAt");
CREATE INDEX "WebsiteCrawl_status_nextPollAt_idx" ON "WebsiteCrawl"("status", "nextPollAt");
CREATE UNIQUE INDEX "WebsitePage_crawlId_canonicalUrl_key" ON "WebsitePage"("crawlId", "canonicalUrl");
CREATE INDEX "WebsitePage_crawlId_analysisStatus_nextAttemptAt_idx" ON "WebsitePage"("crawlId", "analysisStatus", "nextAttemptAt");
CREATE INDEX "WebsitePage_search_idx" ON "WebsitePage" USING GIN (
  to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("markdown", ''))
);
CREATE INDEX "WebsiteCrawlWebhookEvent_crawlId_receivedAt_idx" ON "WebsiteCrawlWebhookEvent"("crawlId", "receivedAt");
CREATE INDEX "ProfileQuestion_profileId_status_idx" ON "ProfileQuestion"("profileId", "status");

ALTER TABLE "OrganizationProfile" ADD CONSTRAINT "OrganizationProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationProfileSnapshot" ADD CONSTRAINT "OrganizationProfileSnapshot_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "OrganizationProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteCrawl" ADD CONSTRAINT "WebsiteCrawl_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteCrawl" ADD CONSTRAINT "WebsiteCrawl_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsitePage" ADD CONSTRAINT "WebsitePage_crawlId_fkey"
  FOREIGN KEY ("crawlId") REFERENCES "WebsiteCrawl"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteCrawlWebhookEvent" ADD CONSTRAINT "WebsiteCrawlWebhookEvent_crawlId_fkey"
  FOREIGN KEY ("crawlId") REFERENCES "WebsiteCrawl"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileQuestion" ADD CONSTRAINT "ProfileQuestion_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "OrganizationProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill a safe published profile from the fields already used by campaign/reply generation.
INSERT INTO "OrganizationProfile" (
  "id", "organizationId", "draftData", "publishedData", "publishedAt", "staleAt", "createdAt", "updatedAt"
)
SELECT
  'profile_' || md5(o."id"),
  o."id",
  jsonb_build_object(
    'schemaVersion', 1,
    'companyName', u."companyName",
    'websiteUrl', u."websiteUrl",
    'summary', '',
    'offers', CASE WHEN u."offer" IS NULL OR u."offer" = '' THEN '[]'::jsonb ELSE jsonb_build_array(u."offer") END,
    'products', '[]'::jsonb,
    'targetAudiences', CASE WHEN u."targetAudience" IS NULL OR u."targetAudience" = '' THEN '[]'::jsonb ELSE jsonb_build_array(u."targetAudience") END,
    'painPoints', '[]'::jsonb,
    'differentiators', '[]'::jsonb,
    'proof', '[]'::jsonb,
    'geography', '[]'::jsonb,
    'salesProcess', '[]'::jsonb,
    'restrictions', '[]'::jsonb,
    'tone', '',
    'manualNotes', '',
    'unknowns', '[]'::jsonb,
    'sources', '[]'::jsonb
  ),
  jsonb_build_object(
    'schemaVersion', 1,
    'companyName', u."companyName",
    'websiteUrl', u."websiteUrl",
    'summary', '',
    'offers', CASE WHEN u."offer" IS NULL OR u."offer" = '' THEN '[]'::jsonb ELSE jsonb_build_array(u."offer") END,
    'products', '[]'::jsonb,
    'targetAudiences', CASE WHEN u."targetAudience" IS NULL OR u."targetAudience" = '' THEN '[]'::jsonb ELSE jsonb_build_array(u."targetAudience") END,
    'painPoints', '[]'::jsonb,
    'differentiators', '[]'::jsonb,
    'proof', '[]'::jsonb,
    'geography', '[]'::jsonb,
    'salesProcess', '[]'::jsonb,
    'restrictions', '[]'::jsonb,
    'tone', '',
    'manualNotes', '',
    'unknowns', '[]'::jsonb,
    'sources', '[]'::jsonb
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + INTERVAL '30 days',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
JOIN "User" u ON u."id" = o."ownerId";

INSERT INTO "OrganizationProfileSnapshot" ("id", "profileId", "version", "data", "createdById")
SELECT 'snapshot_' || md5(p."id"), p."id", 1, p."publishedData", o."ownerId"
FROM "OrganizationProfile" p
JOIN "Organization" o ON o."id" = p."organizationId"
WHERE p."publishedData" IS NOT NULL;
