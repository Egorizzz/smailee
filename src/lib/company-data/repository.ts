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
  const company = await findOrCreateCompany(db, input);
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
  if (existingRecord?.checksum === checksum) {
    await db.companySourceRecord.update({ where: { id: existingRecord.id }, data: { companyId: updatedCompany.id, observedAt: new Date() } });
    return { companyId: updatedCompany.id, sourceRecordId: existingRecord.id, unchanged: true };
  }
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
  const countryCode = identity.countryCode ?? "RU";
  const clauses: Prisma.CompanyWhereInput[] = [
    ...(identity.inn ? [{ countryCode, inn: identity.inn }] : []),
    ...(identity.ogrn ? [{ countryCode, ogrn: identity.ogrn }] : []),
    ...(identity.domain ? [{ domain: identity.domain }] : []),
  ];
  const matches = clauses.length ? await db.company.findMany({ where: { OR: clauses }, orderBy: { createdAt: "asc" } }) : [];
  const taxMatch = matches.find((company) =>
    (identity.inn && company.countryCode === countryCode && company.inn === identity.inn) ||
    (identity.ogrn && company.countryCode === countryCode && company.ogrn === identity.ogrn),
  );
  const domainMatches = identity.domain ? matches.filter((company) => company.domain === identity.domain) : [];
  const domainOnlyMatches = domainMatches.filter((company) => !company.inn && !company.ogrn);
  const identifiedDomainMatches = domainMatches.filter((company) => company.inn || company.ogrn);
  let company = taxMatch;

  if (!company && (identity.inn || identity.ogrn)) company = domainOnlyMatches[0];
  if (!company && !identity.inn && !identity.ogrn) {
    if (identifiedDomainMatches.length === 1) company = identifiedDomainMatches[0];
    else if (domainOnlyMatches.length) company = domainOnlyMatches[0];
    else if (matches.length === 1) company = matches[0];
  }

  if (company) {
    // Запись только с доменом — временная оболочка. Когда появляется ИНН/ОГРН
    // или на домене остаётся ровно одно юрлицо, переносим накопленные данные в
    // каноническую компанию. Разные подтверждённые ИНН на общем домене не склеиваем.
    const mergeable = domainOnlyMatches.filter((candidate) => candidate.id !== company!.id);
    for (const duplicate of mergeable) await mergeCompanyInto(db, company.id, duplicate.id);
    return await db.company.findUniqueOrThrow({ where: { id: company.id } });
  }
  return db.company.create({ data: {
    countryCode, inn: identity.inn, ogrn: identity.ogrn,
    domain: identity.domain, legalName: input.legalName,
    displayName: input.displayName ?? input.legalName, website: input.website,
    status: input.status, data: json(input.fields ?? {}),
  } });
}

/** Resolve a company supplied by a customer without creating a second domain-only shell. */
export async function resolveCanonicalCompany(prisma: PrismaClient, input: {
  inn?: string; domain?: string; legalName?: string; displayName?: string; website?: string;
}): Promise<Company> {
  const normalized = normalizeProviderCompany("user_upload", {
    externalId: input.inn ?? input.domain ?? crypto.randomUUID(),
    identity: { countryCode: "RU", inn: input.inn, domain: input.domain },
    legalName: input.legalName, displayName: input.displayName, website: input.website,
    raw: { origin: "user_upload" },
  });
  return prisma.$transaction(async (db) => {
    const company = await findOrCreateCompany(db, normalized);
    return db.company.update({
      where: { id: company.id },
      data: {
        inn: normalized.identity?.inn ?? company.inn,
        legalName: normalized.legalName ?? company.legalName,
        displayName: normalized.displayName ?? company.displayName ?? normalized.legalName,
        website: normalized.website ?? company.website,
        domain: normalized.identity?.domain ?? company.domain,
        lastSeenAt: new Date(),
      },
    });
  });
}

/** One-time/scheduled cleanup for old domain shells created before tax identity was known. */
export async function consolidateDuplicateCompanies(prisma: PrismaClient): Promise<number> {
  const companies = await prisma.company.findMany({ where: { domain: { not: null } }, orderBy: { createdAt: "asc" } });
  const byDomain = new Map<string, Company[]>();
  for (const company of companies) {
    if (!company.domain) continue;
    const group = byDomain.get(company.domain) ?? [];
    group.push(company);
    byDomain.set(company.domain, group);
  }
  let merged = 0;
  for (const group of byDomain.values()) {
    if (group.length < 2) continue;
    const identified = group.filter((company) => company.inn || company.ogrn);
    const shells = group.filter((company) => !company.inn && !company.ogrn);
    const primary = identified.length === 1 ? identified[0] : identified.length === 0 ? shells[0] : null;
    if (!primary) continue; // общий сайт нескольких подтверждённых юрлиц — неоднозначно
    for (const duplicate of shells) {
      if (duplicate.id === primary.id) continue;
      await prisma.$transaction((db) => mergeCompanyInto(db, primary.id, duplicate.id));
      merged++;
    }
  }
  return merged;
}

async function mergeCompanyInto(db: Prisma.TransactionClient, primaryId: string, duplicateId: string): Promise<void> {
  if (primaryId === duplicateId) return;
  const [primary, duplicate] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: primaryId } }),
    db.company.findUniqueOrThrow({ where: { id: duplicateId } }),
  ]);
  const communicationNameWinner = (duplicate.communicationNameConfidence ?? -1) > (primary.communicationNameConfidence ?? -1)
    ? duplicate
    : primary;

  await db.contact.updateMany({ where: { sourceCompanyId: duplicateId }, data: { sourceCompanyId: primaryId } });
  await db.companySourceRecord.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });
  await db.prospectingRunIssue.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });
  await db.contactRelevanceFeedback.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });

  const duplicateFields = await db.companyFieldValue.findMany({ where: { companyId: duplicateId } });
  for (const value of duplicateFields) {
    const current = await db.companyFieldValue.findUnique({ where: { companyId_fieldId: { companyId: primaryId, fieldId: value.fieldId } } });
    if (!current) {
      await db.companyFieldValue.update({ where: { id: value.id }, data: { companyId: primaryId } });
      continue;
    }
    const duplicateWins = value.sourcePriority > current.sourcePriority ||
      (value.sourcePriority === current.sourcePriority && value.observedAt > current.observedAt);
    if (duplicateWins) {
      await db.companyFieldValue.delete({ where: { id: current.id } });
      await db.companyFieldValue.update({ where: { id: value.id }, data: { companyId: primaryId } });
    } else {
      await db.companyFieldValue.delete({ where: { id: value.id } });
    }
  }

  const duplicateContacts = await db.companyProspectContact.findMany({ where: { companyId: duplicateId } });
  for (const contact of duplicateContacts) {
    const current = await db.companyProspectContact.findUnique({ where: { companyId_email: { companyId: primaryId, email: contact.email } } });
    if (!current) {
      await db.companyProspectContact.update({ where: { id: contact.id }, data: { companyId: primaryId } });
      continue;
    }
    const sources = await db.companyProspectContactSource.findMany({ where: { contactId: contact.id } });
    for (const source of sources) {
      const currentSource = await db.companyProspectContactSource.findUnique({ where: { contactId_sourceKey: { contactId: current.id, sourceKey: source.sourceKey } } });
      if (!currentSource) {
        await db.companyProspectContactSource.update({ where: { id: source.id }, data: { contactId: current.id } });
      } else {
        if (source.observedAt > currentSource.observedAt) await db.companyProspectContactSource.update({ where: { id: currentSource.id }, data: {
          provider: source.provider, sourceUrl: source.sourceUrl, rawData: source.rawData ?? Prisma.DbNull, observedAt: source.observedAt,
        } });
        await db.companyProspectContactSource.delete({ where: { id: source.id } });
      }
    }
    const runContacts = await db.prospectingRunContact.findMany({ where: { contactId: contact.id } });
    for (const runContact of runContacts) {
      const existing = await db.prospectingRunContact.findUnique({ where: { runId_contactId: { runId: runContact.runId, contactId: current.id } } });
      if (existing) await db.prospectingRunContact.delete({ where: { id: runContact.id } });
      else await db.prospectingRunContact.update({ where: { id: runContact.id }, data: { companyId: primaryId, contactId: current.id } });
    }
    await db.prospectingRunCompany.updateMany({ where: { selectedContactId: contact.id }, data: { selectedContactId: current.id } });
    await db.companyProspectContact.update({ where: { id: current.id }, data: {
      name: current.name ?? contact.name, role: current.role ?? contact.role,
      confidence: Math.max(current.confidence, contact.confidence),
      verificationStatus: current.verificationStatus ?? contact.verificationStatus,
      verificationState: current.verificationState === "UNVERIFIED" ? contact.verificationState : current.verificationState,
      verificationScore: current.verificationScore ?? contact.verificationScore,
      verificationSource: current.verificationSource ?? contact.verificationSource,
      verifiedAt: current.verifiedAt ?? contact.verifiedAt,
    } });
    await db.companyProspectContact.delete({ where: { id: contact.id } });
  }
  await db.prospectingRunContact.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });

  const duplicateCandidates = await db.prospectingRunCompany.findMany({ where: { companyId: duplicateId } });
  const statusRank: Record<string, number> = { ACCEPTED: 4, PROCESSING: 3, PENDING: 2, REJECTED: 1, FAILED: 0 };
  for (const candidate of duplicateCandidates) {
    const current = await db.prospectingRunCompany.findUnique({ where: { runId_companyId: { runId: candidate.runId, companyId: primaryId } } });
    if (!current) {
      await db.prospectingRunCompany.update({ where: { id: candidate.id }, data: { companyId: primaryId } });
      continue;
    }
    if ((statusRank[candidate.status] ?? 0) > (statusRank[current.status] ?? 0)) await db.prospectingRunCompany.update({ where: { id: current.id }, data: {
      status: candidate.status, selectedContactId: candidate.selectedContactId,
      rejectionReason: candidate.rejectionReason, error: candidate.error,
      personalizationHooks: json(candidate.personalizationHooks as JsonValue), usage: json(candidate.usage as JsonValue),
      attempts: Math.max(current.attempts, candidate.attempts),
      startedAt: current.startedAt ?? candidate.startedAt, completedAt: current.completedAt ?? candidate.completedAt,
    } });
    await db.prospectingRunCompany.delete({ where: { id: candidate.id } });
  }

  const [primarySite, duplicateSite] = await Promise.all([
    db.companySiteIntelligence.findUnique({ where: { companyId: primaryId } }),
    db.companySiteIntelligence.findUnique({ where: { companyId: duplicateId } }),
  ]);
  if (duplicateSite) {
    if (!primarySite) await db.companySiteIntelligence.update({ where: { id: duplicateSite.id }, data: { companyId: primaryId } });
    else if ((duplicateSite.analyzedAt?.getTime() ?? 0) > (primarySite.analyzedAt?.getTime() ?? 0)) {
      await db.companySiteIntelligence.update({ where: { id: primarySite.id }, data: {
        rootUrl: duplicateSite.rootUrl, provider: duplicateSite.provider, status: duplicateSite.status,
        pages: json(duplicateSite.pages as JsonValue), intelligence: json(duplicateSite.intelligence as JsonValue), contentHash: duplicateSite.contentHash,
        creditsUsed: duplicateSite.creditsUsed, analyzedAt: duplicateSite.analyzedAt,
        expiresAt: duplicateSite.expiresAt, error: duplicateSite.error,
      } });
      await db.companySiteIntelligence.delete({ where: { id: duplicateSite.id } });
    } else await db.companySiteIntelligence.delete({ where: { id: duplicateSite.id } });
  }

  await db.company.update({ where: { id: primaryId }, data: {
    legalName: primary.legalName ?? duplicate.legalName,
    displayName: primary.displayName ?? duplicate.displayName,
    communicationName: communicationNameWinner.communicationName,
    communicationNameConfidence: communicationNameWinner.communicationNameConfidence,
    communicationNameSource: communicationNameWinner.communicationNameSource,
    communicationNameEvidence: communicationNameWinner.communicationNameEvidence,
    communicationNameUpdatedAt: communicationNameWinner.communicationNameUpdatedAt,
    website: primary.website ?? duplicate.website,
    domain: primary.domain ?? duplicate.domain,
    status: primary.status ?? duplicate.status,
    data: json({ ...asObject(duplicate.data), ...asObject(primary.data) }),
    firstSeenAt: primary.firstSeenAt < duplicate.firstSeenAt ? primary.firstSeenAt : duplicate.firstSeenAt,
    lastSeenAt: primary.lastSeenAt > duplicate.lastSeenAt ? primary.lastSeenAt : duplicate.lastSeenAt,
  } });
  await db.company.delete({ where: { id: duplicateId } });
}

async function upsertField(
  db: Prisma.TransactionClient, source: CompanyDataSource, companyId: string,
  sourceRecordId: string, key: string, value: JsonValue, observedAt: Date,
) {
  const inferred = inferFieldValue(value);
  let field = await db.companyFieldDefinition.upsert({
    where: { key }, create: { key, type: inferred.type }, update: {},
  });
  if (field.type !== inferred.type && field.type !== "JSON") {
    // Внешние API иногда расширяют одно и то же поле: например, список строк
    // превращается в список объектов. Сохраняем обе формы как JSON вместо того,
    // чтобы останавливать импорт всей карточки компании.
    const existingValues = await db.companyFieldValue.findMany({
      where: { fieldId: field.id }, select: { id: true, rawValue: true },
    });
    for (const existing of existingValues) {
      await db.companyFieldValue.update({
        where: { id: existing.id },
        data: {
          stringValue: null, numberValue: null, booleanValue: null, dateValue: null,
          stringList: [], jsonValue: json(existing.rawValue as JsonValue),
        },
      });
    }
    field = await db.companyFieldDefinition.update({ where: { id: field.id }, data: { type: "JSON" } });
  }
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
