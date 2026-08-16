CREATE TYPE "CompanyFieldType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'STRING_LIST', 'JSON');

CREATE TABLE "Company" (
  "id" TEXT NOT NULL, "countryCode" TEXT NOT NULL DEFAULT 'RU', "inn" TEXT, "ogrn" TEXT,
  "legalName" TEXT, "displayName" TEXT, "website" TEXT, "domain" TEXT, "status" TEXT,
  "data" JSONB NOT NULL DEFAULT '{}', "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CompanyDataSource" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL, "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true, "capabilities" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyDataSource_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CompanySourceRecord" (
  "id" TEXT NOT NULL, "sourceId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "externalId" TEXT NOT NULL,
  "rawData" JSONB NOT NULL, "normalizedData" JSONB NOT NULL, "checksum" TEXT NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3), "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanySourceRecord_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CompanyFieldDefinition" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "label" TEXT, "type" "CompanyFieldType" NOT NULL,
  "filterable" BOOLEAN NOT NULL DEFAULT true, "facetable" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyFieldDefinition_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CompanyFieldValue" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "fieldId" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "sourceRecordId" TEXT, "sourcePriority" INTEGER NOT NULL DEFAULT 0, "stringValue" TEXT,
  "numberValue" DECIMAL(30,6), "booleanValue" BOOLEAN, "dateValue" TIMESTAMP(3),
  "stringList" TEXT[] DEFAULT ARRAY[]::TEXT[], "jsonValue" JSONB, "rawValue" JSONB NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyFieldValue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Company_countryCode_inn_key" ON "Company"("countryCode", "inn");
CREATE UNIQUE INDEX "Company_countryCode_ogrn_key" ON "Company"("countryCode", "ogrn");
CREATE INDEX "Company_domain_idx" ON "Company"("domain");
CREATE INDEX "Company_displayName_idx" ON "Company"("displayName");
CREATE UNIQUE INDEX "CompanyDataSource_key_key" ON "CompanyDataSource"("key");
CREATE UNIQUE INDEX "CompanySourceRecord_sourceId_externalId_key" ON "CompanySourceRecord"("sourceId", "externalId");
CREATE INDEX "CompanySourceRecord_companyId_observedAt_idx" ON "CompanySourceRecord"("companyId", "observedAt");
CREATE INDEX "CompanySourceRecord_checksum_idx" ON "CompanySourceRecord"("checksum");
CREATE UNIQUE INDEX "CompanyFieldDefinition_key_key" ON "CompanyFieldDefinition"("key");
CREATE UNIQUE INDEX "CompanyFieldValue_companyId_fieldId_key" ON "CompanyFieldValue"("companyId", "fieldId");
CREATE INDEX "CompanyFieldValue_fieldId_stringValue_idx" ON "CompanyFieldValue"("fieldId", "stringValue");
CREATE INDEX "CompanyFieldValue_fieldId_numberValue_idx" ON "CompanyFieldValue"("fieldId", "numberValue");
CREATE INDEX "CompanyFieldValue_fieldId_booleanValue_idx" ON "CompanyFieldValue"("fieldId", "booleanValue");
CREATE INDEX "CompanyFieldValue_fieldId_dateValue_idx" ON "CompanyFieldValue"("fieldId", "dateValue");
CREATE INDEX "CompanyFieldValue_sourceId_observedAt_idx" ON "CompanyFieldValue"("sourceId", "observedAt");
ALTER TABLE "CompanySourceRecord" ADD CONSTRAINT "CompanySourceRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CompanyDataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanySourceRecord" ADD CONSTRAINT "CompanySourceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyFieldValue" ADD CONSTRAINT "CompanyFieldValue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyFieldValue" ADD CONSTRAINT "CompanyFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CompanyFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyFieldValue" ADD CONSTRAINT "CompanyFieldValue_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CompanyDataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyFieldValue" ADD CONSTRAINT "CompanyFieldValue_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "CompanySourceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
