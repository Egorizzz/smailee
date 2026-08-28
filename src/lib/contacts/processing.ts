import { createHash } from "node:crypto";
import { Prisma, type EmailVerificationState, type PrismaClient } from "@prisma/client";
import { analyzeCompanySite } from "@/lib/company-data/siteIntelligence";
import { cachedExternalOperation } from "@/lib/company-data/operationCache";
import { reoonFromEnv } from "@/lib/company-data/providers/env";
import { verificationState } from "@/lib/company-data/emailVerification";
import { normalizeRussianInn } from "@/lib/company-data/normalize";
import { resolveCanonicalCompany } from "@/lib/company-data/repository";
import { businessDomainFromEmails } from "@/lib/company-data/domainInference";
import {
  canSkipSiteEnrichment,
  personalizationAssessmentInput,
  personalizationContextHash,
  type ImportPersonalizationAssessment,
} from "@/lib/contacts/importSafety";
import type { ImportedValidation, WorkbookContact } from "@/lib/contacts/workbookImport";

export type ProcessedUpload = {
  contactId: string;
  email: string;
  verificationState: EmailVerificationState;
  invalid: boolean;
  siteAnalyzed: boolean;
  siteSkipped: boolean;
  issues: Array<{ code: string; stage: string }>;
};

export async function processUploadedContact(prisma: PrismaClient, input: {
  organizationId: string; userId: string; email: string; name?: string; company?: string;
  inn?: string; segment?: string; customFields?: Record<string, string>; suppressed: boolean;
  personalizationAssessment?: ImportPersonalizationAssessment;
  prevalidated?: ImportedValidation;
  importProvenance?: WorkbookContact["provenance"];
}): Promise<ProcessedUpload> {
  const email = input.email.trim().toLowerCase();
  const explicitWebsite = Object.entries(input.customFields ?? {}).find(([key, value]) => /(?:website|site|url|сайт)/i.test(key) && typeof value === "string")?.[1];
  const website = typeof explicitWebsite === "string" ? normalizeWebsite(explicitWebsite) : undefined;
  const domain = website ? new URL(website).hostname.replace(/^www\./, "").toLowerCase() : businessDomainFromEmails([email]);
  const inn = normalizeRussianInn(input.inn);
  const issues: Array<{ code: string; stage: string }> = [];
  let state: EmailVerificationState = "UNKNOWN";
  let providerStatus = "unknown";
  let score: number | undefined;

  if (input.prevalidated) {
    state = input.prevalidated.state;
    providerStatus = input.prevalidated.status;
    score = input.prevalidated.score;
  } else {
    try {
      const reoon = reoonFromEnv();
      const cached = await cachedExternalOperation({
        prisma, provider: reoon.key, operation: "verifyEmail", params: { email },
        execute: () => reoon.verifyEmail(email), usage: (value) => value.usage,
      });
      state = verificationState(cached.value.status);
      providerStatus = cached.value.providerStatus;
      score = cached.value.score;
    } catch (error) {
      console.error("[CNT-1201] upload verification", { email, error });
      issues.push({ code: "CNT-1201", stage: "email_verification" });
    }
  }
  const invalid = ["INVALID", "DISPOSABLE", "BLOCKED"].includes(state);
  const assessmentContext = personalizationAssessmentInput(input, "row").context;
  const contextHash = personalizationContextHash({ id: "row", context: assessmentContext });
  const skipSiteForContext = canSkipSiteEnrichment(input.personalizationAssessment);
  const companyRecord = inn || domain ? await resolveCanonicalCompany(prisma, {
    inn, domain, legalName: input.company, displayName: input.company || domain,
    website: website ?? (domain ? `https://${domain}` : undefined),
  }) : null;

  const existingContact = await prisma.contact.findUnique({
    where: { userId_email: { userId: input.userId, email } },
    select: { meta: true, customFields: true },
  });
  const mergedCustomFields = {
    ...jsonStringRecord(existingContact?.customFields),
    ...(input.customFields ?? {}),
  };
  const contactMeta = {
    ...jsonRecord(existingContact?.meta),
    ...(input.importProvenance?.length ? {
      import: {
        version: 2,
        matchedSources: input.importProvenance,
        sourceRows: input.importProvenance.length,
        externalValidation: input.prevalidated ? {
          source: input.prevalidated.source,
          state: input.prevalidated.state,
          declaredAtImport: !input.prevalidated.validatedAt,
        } : null,
      },
    } : {}),
    importEnrichment: {
      version: 1,
      assessedAt: new Date().toISOString(),
      contextHash,
      decision: invalid
        ? "SKIPPED_INVALID_EMAIL"
        : skipSiteForContext
          ? "SKIPPED_ROW_CONTEXT_SUFFICIENT"
          : input.personalizationAssessment
            ? "SITE_ENRICHMENT_REQUIRED"
            : "ASSESSMENT_UNAVAILABLE",
      confidence: input.personalizationAssessment?.confidence ?? null,
      reason: input.personalizationAssessment?.reason ?? null,
    },
  } as Prisma.InputJsonValue;

  const contact = await prisma.contact.upsert({
    where: { userId_email: { userId: input.userId, email } },
    create: {
      userId: input.userId, email, name: input.name, company: input.company, segment: input.segment,
      meta: contactMeta,
      customFields: Object.keys(mergedCustomFields).length ? mergedCustomFields as Prisma.InputJsonValue : undefined,
      source: "USER_UPLOAD", sourceCompanyId: companyRecord?.id, domain, website: companyRecord?.website,
      emailValid: !invalid, verificationState: state, verificationStatus: providerStatus,
      verificationScore: score, verificationSource: input.prevalidated?.source ?? "reoon",
      lastValidatedAt: validationDate(input.prevalidated?.validatedAt) ?? new Date(),
      status: input.suppressed ? "UNSUBSCRIBED" : invalid ? "INVALID" : "ACTIVE",
    },
    update: {
      name: input.name, company: input.company, segment: input.segment,
      meta: contactMeta,
      customFields: Object.keys(mergedCustomFields).length ? mergedCustomFields as Prisma.InputJsonValue : undefined,
      sourceCompanyId: companyRecord?.id, domain, website: companyRecord?.website,
      emailValid: !invalid, verificationState: state, verificationStatus: providerStatus,
      verificationScore: score, verificationSource: input.prevalidated?.source ?? "reoon",
      lastValidatedAt: validationDate(input.prevalidated?.validatedAt) ?? new Date(),
      status: input.suppressed ? "UNSUBSCRIBED" : invalid ? "INVALID" : "ACTIVE",
    },
  });

  await prisma.contactQuotaEvent.upsert({
    where: { operationKey: quotaKey(input.organizationId, email) },
    create: { organizationId: input.organizationId, userId: input.userId, operationKey: quotaKey(input.organizationId, email), email, source: "USER_UPLOAD", contactId: contact.id },
    update: { contactId: contact.id },
  });

  let siteAnalyzed = false;
  const siteSkipped = invalid || skipSiteForContext;
  if (companyRecord?.website && !siteSkipped) {
    try { await analyzeCompanySite(prisma, companyRecord.id, { maxPages: 2 }); siteAnalyzed = true; }
    catch (error) { console.error("[CNT-1301] uploaded company site", { companyId: companyRecord.id, error }); issues.push({ code: "CNT-1301", stage: "site_analysis" }); }
  }
  return { contactId: contact.id, email, verificationState: state, invalid, siteAnalyzed, siteSkipped, issues };
}

export function quotaKey(organizationId: string, email: string) {
  return `contact:${organizationId}:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
}

function normalizeWebsite(value: string) { try { const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined; } catch { return undefined; } }

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function jsonStringRecord(value: Prisma.JsonValue | null | undefined): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function validationDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}
