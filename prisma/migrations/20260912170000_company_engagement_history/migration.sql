CREATE TYPE "CompanyEngagementEventKind" AS ENUM ('REPLY', 'DECLINED', 'OPT_OUT', 'SPAM_COMPLAINT', 'CRM_HANDOFF');

CREATE TABLE "CompanyEngagementEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactName" TEXT,
    "sourceReplyId" TEXT,
    "kind" "CompanyEngagementEventKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "qualification" "LeadQualification",
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyEngagementEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyEngagementEvent_sourceReplyId_key" ON "CompanyEngagementEvent"("sourceReplyId");
CREATE INDEX "CompanyEngagementEvent_userId_companyId_occurredAt_idx" ON "CompanyEngagementEvent"("userId", "companyId", "occurredAt");
CREATE INDEX "CompanyEngagementEvent_contactId_occurredAt_idx" ON "CompanyEngagementEvent"("contactId", "occurredAt");

ALTER TABLE "CompanyEngagementEvent"
    ADD CONSTRAINT "CompanyEngagementEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyEngagementEvent"
    ADD CONSTRAINT "CompanyEngagementEvent_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyEngagementEvent"
    ADD CONSTRAINT "CompanyEngagementEvent_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
