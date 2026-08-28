CREATE TABLE "CompanyProspectContact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'generic',
    "name" TEXT,
    "role" TEXT,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verificationStatus" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProspectContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyProspectContact_companyId_email_key" ON "CompanyProspectContact"("companyId", "email");
CREATE INDEX "CompanyProspectContact_email_idx" ON "CompanyProspectContact"("email");
CREATE INDEX "CompanyProspectContact_source_observedAt_idx" ON "CompanyProspectContact"("source", "observedAt");
ALTER TABLE "CompanyProspectContact" ADD CONSTRAINT "CompanyProspectContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
