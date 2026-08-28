CREATE TABLE "CompanySiteIntelligence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rootUrl" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'firecrawl',
    "status" TEXT NOT NULL DEFAULT 'READY',
    "pages" JSONB NOT NULL DEFAULT '[]',
    "intelligence" JSONB NOT NULL DEFAULT '{}',
    "contentHash" TEXT,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "analyzedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySiteIntelligence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanySiteIntelligence_companyId_key" ON "CompanySiteIntelligence"("companyId");
CREATE INDEX "CompanySiteIntelligence_status_expiresAt_idx" ON "CompanySiteIntelligence"("status", "expiresAt");
ALTER TABLE "CompanySiteIntelligence" ADD CONSTRAINT "CompanySiteIntelligence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
