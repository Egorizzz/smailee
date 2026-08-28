import { createHash } from "node:crypto";
import { companySiteIntelligenceSchema } from "@/lib/company-data/siteIntelligence";
import { publicCompanyFacts } from "@/lib/company-data/contactPresentation";
import { effectiveCommunicationName } from "@/lib/mail/recipientPersonalization";

export const PERSONALIZED_EMAIL_REVISION = 2;
export const PERSONALIZED_EMAIL_CONTEXT_MAX_CHARS = 8_000;

export type PersonalizationSignal = {
  id: string;
  label: string;
  value: string;
  evidence?: string;
  priority: "primary" | "supporting";
};

export type PersonalizedRecipientContext = {
  recipient: {
    name: string | null;
    role: string | null;
    email: string;
  };
  company: {
    name: string | null;
    domain: string | null;
    website: string | null;
    segment: string | null;
  };
  summary: string | null;
  signals: PersonalizationSignal[];
};

export type PersonalizedEmailGenerationInput = {
  campaign: {
    name: string;
    segment: string | null;
    step: number;
    subjectGuide: string;
    bodyGuide: string;
  };
  sender: {
    offer: string;
    targetAudience: string;
    websiteUrl: string | null;
    businessContext: string | null;
  };
  recipient: PersonalizedRecipientContext;
  previousEmails: Array<{ subject: string; body: string }>;
};

type RecipientContextInput = {
  contact: {
    name?: string | null;
    email: string;
    role?: string | null;
    segment?: string | null;
    company?: string | null;
    communicationNameOverride?: string | null;
    domain?: string | null;
    website?: string | null;
    customFields?: unknown;
  };
  company?: {
    displayName?: string | null;
    legalName?: string | null;
    communicationName?: string | null;
    communicationNameConfidence?: number | null;
    domain?: string | null;
    website?: string | null;
    inn?: string | null;
    data?: unknown;
    siteIntelligence?: { status?: string | null; intelligence?: unknown } | null;
  } | null;
};

/**
 * Builds the only recipient payload allowed into cold-email generation. Raw
 * workbooks and scraped pages never enter the prompt: the generator receives a
 * bounded, structured snapshot that was already normalized and evidence-checked.
 */
export function buildPersonalizedRecipientContext(input: RecipientContextInput): PersonalizedRecipientContext {
  const company = input.company;
  const communicationName = effectiveCommunicationName({
    communicationNameOverride: input.contact.communicationNameOverride,
    communicationName: company?.communicationName,
    communicationNameConfidence: company?.communicationNameConfidence,
  });
  const companyData = record(company?.data);
  const site = company?.siteIntelligence?.status === "READY"
    ? companySiteIntelligenceSchema.safeParse(company.siteIntelligence.intelligence)
    : null;
  const siteData = site?.success ? site.data : null;
  const signals: PersonalizationSignal[] = [];

  if (input.contact.role?.trim()) pushSignal(signals, "contact_role", "Должность", input.contact.role, null, "supporting");
  if (input.contact.segment?.trim()) pushSignal(signals, "contact_segment", "Сегмент", input.contact.segment, null, "supporting");

  for (const [index, entry] of boundedCustomFields(input.contact.customFields).entries()) {
    pushSignal(signals, `custom_${index + 1}`, entry.label, entry.value, null, "primary");
  }

  for (const fact of publicCompanyFacts(companyData, { inn: company?.inn })) {
    if (!["activity", "region", "employees"].includes(fact.key)) continue;
    pushSignal(signals, `company_${fact.key}`, fact.label, fact.value, null, "supporting");
  }

  if (siteData?.summary) pushSignal(signals, "site_summary", "Профиль компании", siteData.summary, null, "primary");

  for (const [index, hook] of (siteData?.personalizationHooks ?? []).entries()) {
    pushSignal(signals, `site_hook_${index + 1}`, "Факт для персонализации", hook.value, hook.evidence, "primary");
  }

  const usedValues = new Set(signals.map((item) => normalizeKey(item.value)));
  for (const fact of siteData?.facts ?? []) {
    if (signals.length >= 32 || usedValues.has(normalizeKey(fact.value))) continue;
    const priority = ["offer", "product", "differentiator", "proof"].includes(fact.category) ? "primary" : "supporting";
    pushSignal(signals, `site_fact_${fact.category}_${signals.length + 1}`, fact.category, fact.value, fact.evidence, priority);
    usedValues.add(normalizeKey(fact.value));
  }

  const context: PersonalizedRecipientContext = {
    recipient: {
      name: clean(input.contact.name, 120),
      role: clean(input.contact.role, 180),
      email: clean(input.contact.email, 320) ?? "",
    },
    company: {
      name: clean(communicationName, 180),
      domain: clean(company?.domain ?? input.contact.domain, 240),
      website: clean(company?.website ?? input.contact.website, 500),
      segment: clean(input.contact.segment, 180),
    },
    summary: clean(siteData?.summary, 1_800),
    signals,
  };

  return trimContext(context);
}

export function personalizedEmailContextHash(input: unknown) {
  return createHash("sha256")
    .update(JSON.stringify({ revision: PERSONALIZED_EMAIL_REVISION, input }))
    .digest("hex");
}

export function hasSubstantivePersonalization(context: PersonalizedRecipientContext) {
  return context.signals.some((signal) => signal.priority === "primary");
}

/** Ensures a claimed primary fact has recognizable grounding in final copy. */
export function groundedPersonalizationIds(
  body: string,
  signals: PersonalizationSignal[],
  claimedIds: string[],
) {
  const bodyTokens = significantTokenStems(body);
  const claimed = new Set(claimedIds);
  return signals.filter((signal) => signal.priority === "primary" && claimed.has(signal.id)).filter((signal) => {
    const signalTokens = significantTokenStems(`${signal.value} ${signal.evidence ?? ""}`);
    return [...signalTokens].some((token) => bodyTokens.has(token));
  }).map((signal) => signal.id);
}

function trimContext(context: PersonalizedRecipientContext) {
  while (JSON.stringify(context).length > PERSONALIZED_EMAIL_CONTEXT_MAX_CHARS && context.signals.length > 1) {
    context.signals.pop();
  }
  if (JSON.stringify(context).length > PERSONALIZED_EMAIL_CONTEXT_MAX_CHARS) context.summary = clean(context.summary, 500);
  return context;
}

function boundedCustomFields(value: unknown): Array<{ label: string; value: string }> {
  const source = record(value);
  const out: Array<{ label: string; value: string }> = [];
  let total = 0;
  for (const [rawLabel, rawValue] of Object.entries(source)) {
    if (out.length >= 20 || total >= 3_500) break;
    const label = clean(rawLabel, 100);
    const text = primitiveText(rawValue);
    if (!label || !text || /^(?:email|e-mail|почта)$/i.test(label)) continue;
    const bounded = text.slice(0, Math.min(500, 3_500 - total));
    out.push({ label, value: bounded });
    total += label.length + bounded.length;
  }
  return out;
}

function primitiveText(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return clean(String(value), 500);
  }
  if (Array.isArray(value)) {
    const joined = value.filter((item) => ["string", "number", "boolean"].includes(typeof item)).slice(0, 10).join(", ");
    return clean(joined, 500);
  }
  return null;
}

function pushSignal(
  signals: PersonalizationSignal[],
  id: string,
  label: string,
  value?: string | null,
  evidence?: string | null,
  priority: PersonalizationSignal["priority"] = "primary",
) {
  const cleanedValue = clean(value, 600);
  if (!cleanedValue || signals.some((item) => normalizeKey(item.value) === normalizeKey(cleanedValue))) return;
  signals.push({ id, label: clean(label, 120) ?? "Факт", value: cleanedValue, evidence: clean(evidence, 400) ?? undefined, priority });
}

function clean(value: string | null | undefined, max: number) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function normalizeKey(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const TOKEN_STOP_WORDS = new Set(["котор", "этот", "ваш", "наши", "компан", "орган", "работ", "услуг", "деятел", "област", "предлаг", "сотруд"]);

function significantTokenStems(value: string) {
  const tokens = value.toLocaleLowerCase("ru-RU").match(/[\p{L}\p{N}]{5,}/gu) ?? [];
  return new Set(tokens.map((token) => token.slice(0, 6)).filter((token) => !TOKEN_STOP_WORDS.has(token.slice(0, 5))));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
