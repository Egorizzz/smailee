import { Prisma, type Company, type CompanyDataSource, type PrismaClient } from "@prisma/client";
import { fieldValueOfType, inferFieldValue, normalizeProviderCompany, stableChecksum } from "./normalize";
import type { CompanyFilter, JsonValue, ProviderCompany, ProviderFieldDefinition } from "./types";
import { compileCompanyFilter } from "./filters";

type Db = PrismaClient | Prisma.TransactionClient;

export type IngestResult = { companyId: string; sourceRecordId: string; unchanged: boolean };

export async function ensureCompanyDataSource(
  db: Db,
  input: { key: string; name: string; priority?: number; capabilities?: Record<string, JsonValue> },
): Promise<CompanyDataSource> {
  return db.companyDataSource.upsert({
    where: { key: input.key },
    create: {
      key: input.key, name: input.name, priority: input.priority ?? 0,
      capabilities: json(input.capabilities ?? {}),
    },
    update: {
      name: input.name, priority: input.priority ?? 0,
      capabilities: json(input.capabilities ?? {}),
    },
  });
}

export async function ensureCompanyFieldDefinitions(db: Db, definitions: readonly ProviderFieldDefinition[]) {
  for (const definition of definitions) {
    await db.companyFieldDefinition.upsert({
      where: { key: definition.key },
      create: {
        key: definition.key, type: definition.type, label: definition.label,
        filterable: definition.filterable ?? true, facetable: definition.facetable ?? false,
      },
      update: {
        type: definition.type, label: definition.label,
        filterable: definition.filterable ?? true, facetable: definition.facetable ?? false,
      },
    });
  }
}

export async function ingestProviderCompanies(
  prisma: PrismaClient,
  sourceKey: string,
  inputs: ProviderCompany[],
): Promise<IngestResult[]> {
  const source = await prisma.companyDataSource.findUniqueOrThrow({ where: { key: sourceKey } });
  const results: IngestResult[] = [];
  for (const rawInput of inputs) {
    results.push(await prisma.$transaction((tx) => ingestOne(tx, source, rawInput)));
  }
  return results;
}

async function ingestOne(db: Prisma.TransactionClient, source: CompanyDataSource, rawInput: ProviderCompany): Promise<IngestResult> {
  const input = normalizeProviderCompany(source.key, rawInput);
  const checksum = stableChecksum(input.raw);
  const existingRecord = await db.companySourceRecord.findUnique({
    where: { sourceId_externalId: { sourceId: source.id, externalId: input.externalId } },
  });
  if (existingRecord?.checksum === checksum) {
    await db.companySourceRecord.update({ where: { id: existingRecord.id }, data: { observedAt: new Date() } });
    await db.company.update({ where: { id: existingRecord.companyId }, data: { lastSeenAt: new Date() } });
    return { companyId: existingRecord.companyId, sourceRecordId: existingRecord.id, unchanged: true };
  }

  const company = existingRecord
    ? await db.company.findUniqueOrThrow({ where: { id: existingRecord.companyId } })
    : await findOrCreateCompany(db, input);
  const mergedData = { ...asObject(company.data), ...(input.fields ?? {}) };
  const updatedCompany = await db.company.update({
    where: { id: company.id },
    data: {
      countryCode: input.identity?.countryCode ?? company.countryCode,
      inn: input.identity?.inn ?? company.inn,
      ogrn: input.identity?.ogrn ?? company.ogrn,
      legalName: input.legalName ?? company.legalName,
      displayName: input.displayName ?? company.displayName ?? input.legalName,
      website: input.website ?? company.website,
      domain: input.identity?.domain ?? company.domain,
      status: input.status ?? company.status,
      data: json(mergedData), lastSeenAt: new Date(),
    },
  });
  const normalized = normalizedJson(input);
  const record = await db.companySourceRecord.upsert({
    where: { sourceId_externalId: { sourceId: source.id, externalId: input.externalId } },
    create: {
      sourceId: source.id, companyId: updatedCompany.id, externalId: input.externalId,
      rawData: json(input.raw), normalizedData: json(normalized), checksum,
      sourceUpdatedAt: input.sourceUpdatedAt, observedAt: new Date(),
    },
    update: {
      companyId: updatedCompany.id, rawData: json(input.raw), normalizedData: json(normalized), checksum,
      sourceUpdatedAt: input.sourceUpdatedAt, observedAt: new Date(),
    },
  });
  for (const [key, value] of Object.entries(input.fields ?? {})) {
    if (value === null) continue;
    await upsertField(db, source, updatedCompany.id, record.id, key, value, record.observedAt);
  }
  return { companyId: updatedCompany.id, sourceRecordId: record.id, unchanged: false };
}

async function findOrCreateCompany(db: Prisma.TransactionClient, input: ProviderCompany): Promise<Company> {
  const identity = input.identity ?? {};
  const company = await db.company.findFirst({ where: {
    OR: [
      ...(identity.inn ? [{ countryCode: identity.countryCode ?? "RU", inn: identity.inn }] : []),
      ...(identity.ogrn ? [{ countryCode: identity.countryCode ?? "RU", ogrn: identity.ogrn }] : []),
      ...(identity.domain ? [{ domain: identity.domain }] : []),
    ],
  } });
  if (company) return company;
  return db.company.create({ data: {
    countryCode: identity.countryCode ?? "RU", inn: identity.inn, ogrn: identity.ogrn,
    domain: identity.domain, legalName: input.legalName,
    displayName: input.displayName ?? input.legalName, website: input.website,
    status: input.status, data: json(input.fields ?? {}),
  } });
}

async function upsertField(
  db: Prisma.TransactionClient, source: CompanyDataSource, companyId: string,
  sourceRecordId: string, key: string, value: JsonValue, observedAt: Date,
) {
  const inferred = inferFieldValue(value);
  const field = await db.companyFieldDefinition.upsert({
    where: { key }, create: { key, type: inferred.type }, update: {},
  });
  const typed = fieldValueOfType(field.type, value);
  const current = await db.companyFieldValue.findUnique({ where: { companyId_fieldId: { companyId, fieldId: field.id } } });
  if (current && (current.sourcePriority > source.priority ||
    (current.sourcePriority === source.priority && current.observedAt > observedAt))) return;
  const values = {
    sourceId: source.id, sourceRecordId, sourcePriority: source.priority,
    stringValue: typed.stringValue ?? null, numberValue: typed.numberValue ?? null,
    booleanValue: typed.booleanValue ?? null, dateValue: typed.dateValue ?? null,
    stringList: typed.stringList ?? [], jsonValue: typed.jsonValue === undefined ? Prisma.DbNull : json(typed.jsonValue),
    rawValue: json(typed.rawValue), observedAt,
  };
  await db.companyFieldValue.upsert({
    where: { companyId_fieldId: { companyId, fieldId: field.id } },
    create: { companyId, fieldId: field.id, ...values }, update: values,
  });
}

export async function searchCompanies(
  db: Db,
  input: { filter?: CompanyFilter; take?: number; cursor?: string },
) {
  const take = Math.min(Math.max(input.take ?? 50, 1), 250);
  return db.company.findMany({
    where: compileCompanyFilter(input.filter), take,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: { id: "asc" },
    include: { fieldValues: { include: { field: true, source: true } }, sourceRecords: { select: { sourceId: true, externalId: true, observedAt: true } } },
  });
}

function normalizedJson(input: ProviderCompany): Record<string, JsonValue> {
  return {
    externalId: input.externalId, identity: (input.identity ?? {}) as Record<string, JsonValue>,
    legalName: input.legalName ?? null, displayName: input.displayName ?? null,
    website: input.website ?? null, status: input.status ?? null, fields: input.fields ?? {},
  };
}
function asObject(value: Prisma.JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
}
function json(value: JsonValue | Record<string, JsonValue>): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}
