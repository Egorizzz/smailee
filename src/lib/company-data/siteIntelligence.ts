import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { canonicalizePageUrl, isUrlInScope, validatePublicWebsiteUrl } from "@/lib/businessProfile/siteSecurity";
import { analyzeBusinessPage } from "@/lib/services/llm";
import { parsePageAnalysisPayload } from "@/lib/businessProfile/types";
import { websiteCrawler, type WebsiteCrawler, type WebsiteDocument } from "@/lib/services/websiteCrawler";
import { COMMUNICATION_NAME_MIN_CONFIDENCE } from "./communicationName";

export { COMMUNICATION_NAME_MIN_CONFIDENCE } from "./communicationName";

export const SITE_INTELLIGENCE_TTL_DAYS = 180;
export const SITE_INTELLIGENCE_MAX_PAGES = 3;
export const SITE_INTELLIGENCE_PAGE_CHARS = 9_000;
export const SITE_INTELLIGENCE_ANALYSIS_REVISION = 2;

const factSchema = z.object({
  category: z.string(),
  value: z.string(),
  evidence: z.string().default(""),
  confidence: z.number().min(0).max(1),
  sourceUrl: z.string().url(),
});

const publicContactSchema = z.object({
  kind: z.enum(["email", "telegram", "linkedin", "vk", "whatsapp"]),
  value: z.string(),
  sourceUrl: z.string().url(),
  generic: z.boolean().default(true),
});

const communicationNameSchema = z.object({
  value: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  sourceUrl: z.string().url(),
});

export const companySiteIntelligenceSchema = z.object({
  schemaVersion: z.literal(1),
  analysisRevision: z.number().int().positive().optional(),
  summary: z.string(),
  facts: z.array(factSchema),
  personalizationHooks: z.array(factSchema).max(3),
  publicContacts: z.array(publicContactSchema).default([]),
  communicationName: communicationNameSchema.nullable().default(null),
});

export type CompanySiteIntelligenceData = z.infer<typeof companySiteIntelligenceSchema>;

type PageSnapshot = { url: string; title: string; contentHash: string; characters: number };
type Analyzer = (input: Parameters<typeof analyzeBusinessPage>[0]) => Promise<unknown>;
type CommunicationNameCandidate = z.infer<typeof communicationNameSchema>;

const POSITIVE_PATHS: Array<[RegExp, number]> = [
  [/(?:^|\/)(?:news|press|media|blog|новости|пресс)(?:\/|$)/i, 90],
  [/(?:^|\/)(?:cases?|projects?|кейсы|проекты)(?:\/|$)/i, 85],
  [/(?:^|\/)(?:products?|services?|solutions?|продукты|услуги|решения)(?:\/|$)/i, 75],
  [/(?:^|\/)(?:about|company|о-компании|компания)(?:\/|$)/i, 65],
  [/(?:^|\/)(?:team|management|leadership|команда|руководство)(?:\/|$)/i, 55],
  [/(?:^|\/)(?:contacts?|contact-us|контакты)(?:\/|$)/i, 70],
];
const REJECT_PATH = /(?:privacy|policy|terms|agreement|cookie|login|register|cart|search|catalog\/page|личн|политик|оферт|соглашен|ваканс)/i;

export function selectCompanySitePages(rootUrl: string, links: string[], limit = SITE_INTELLIGENCE_MAX_PAGES - 1) {
  const root = new URL(rootUrl);
  const candidates = new Map<string, number>();
  for (const raw of links) {
    try {
      const absolute = canonicalizePageUrl(new URL(raw, root).toString());
      if (!isUrlInScope(absolute, rootUrl, false) || absolute === canonicalizePageUrl(rootUrl)) continue;
      const url = new URL(absolute);
      if (REJECT_PATH.test(`${url.pathname}${url.search}`) || /\.(?:pdf|docx?|xlsx?|zip|jpg|jpeg|png|webp)$/i.test(url.pathname)) continue;
      const depth = url.pathname.split("/").filter(Boolean).length;
      if (depth > 3) continue;
      const score = POSITIVE_PATHS.reduce((best, [pattern, weight]) => pattern.test(url.pathname) ? Math.max(best, weight) : best, 0) - depth;
      if (score > 0) candidates.set(absolute, Math.max(score, candidates.get(absolute) ?? 0));
    } catch {
      // Ignore malformed and non-HTTP links returned by the page.
    }
  }
  return [...candidates.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([url]) => url);
}

export function compactCompanyPage(markdown: string, limit = SITE_INTELLIGENCE_PAGE_CHARS) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  let previous = "";
  for (const raw of lines) {
    const line = raw.trim().replace(/[ \t]+/g, " ");
    if (!line || line === previous) continue;
    if (/^\[?[^\]]{0,40}\]?\([^)]*\)$/.test(line) || /^[-*]\s+\[[^\]]+\]\([^)]*\)$/.test(line)) continue;
    kept.push(line);
    previous = line;
    if (kept.join("\n").length >= limit) break;
  }
  return kept.join("\n").slice(0, limit);
}

export function extractMarkdownLinks(markdown: string) {
  const links: string[] = [];
  const pattern = /\[[^\]]*\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of markdown.matchAll(pattern)) {
    if (match[1]) links.push(match[1].replace(/^<|>$/g, ""));
  }
  return links;
}

export async function analyzeCompanySite(
  prisma: PrismaClient,
  companyId: string,
  options: { maxPages?: number; now?: Date } = {},
  dependencies: { crawler?: WebsiteCrawler; analyzer?: Analyzer; validateUrl?: typeof validatePublicWebsiteUrl } = {},
) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, include: { siteIntelligence: true } });
  if (!company) throw new Error("Компания не найдена");
  const now = options.now ?? new Date();
  const cachedPayload = companySiteIntelligenceSchema.safeParse(company.siteIntelligence?.intelligence);
  const cacheKnowsCommunicationName = Boolean(company.communicationName)
    || (cachedPayload.success && (cachedPayload.data.analysisRevision ?? 1) >= SITE_INTELLIGENCE_ANALYSIS_REVISION);
  if (company.siteIntelligence?.status === "READY" && company.siteIntelligence.expiresAt && company.siteIntelligence.expiresAt > now && cacheKnowsCommunicationName) {
    const cached = companySiteIntelligenceSchema.safeParse(company.siteIntelligence.intelligence);
    if (cached.success) await persistCommunicationName(prisma, company.id, cached.data.communicationName, now);
    // A cache hit must not look like fresh Firecrawl spend in run economics.
    return { ...company.siteIntelligence, creditsUsed: 0 };
  }
  const sourceUrl = company.website || company.domain;
  if (!sourceUrl) throw new Error("У компании нет сайта");
  const rootUrl = await (dependencies.validateUrl ?? validatePublicWebsiteUrl)(sourceUrl);
  const crawler = dependencies.crawler ?? websiteCrawler;
  const analyzer = dependencies.analyzer ?? analyzeBusinessPage;
  const maxPages = Math.min(Math.max(options.maxPages ?? SITE_INTELLIGENCE_MAX_PAGES, 1), SITE_INTELLIGENCE_MAX_PAGES);

  await prisma.companySiteIntelligence.upsert({
    where: { companyId },
    create: { companyId, rootUrl, status: "RUNNING" },
    update: { rootUrl, status: "RUNNING", error: null },
  });

  try {
    const homepage = await crawler.scrape(rootUrl);
    const discoveredLinks = [...(homepage.links ?? []), ...extractMarkdownLinks(homepage.markdown)];
    const pageUrls = [rootUrl, ...selectCompanySitePages(rootUrl, discoveredLinks, maxPages - 1)];
    const documents: Array<{ url: string; document: WebsiteDocument }> = [{ url: rootUrl, document: homepage }];
    for (const url of pageUrls.slice(1)) documents.push({ url, document: await crawler.scrape(url) });

    const pages: PageSnapshot[] = [];
    const summaries: string[] = [];
    const facts: CompanySiteIntelligenceData["facts"] = [];
    const publicContacts: CompanySiteIntelligenceData["publicContacts"] = [];
    const communicationNameCandidates: CommunicationNameCandidate[] = [];
    for (const { url, document } of documents) {
      const compact = compactCompanyPage(document.markdown);
      if (compact.length < 80) continue;
      const title = metadataTitle(document.metadata) || new URL(url).pathname || company.displayName || company.legalName || "Сайт компании";
      pages.push({ url, title, characters: compact.length, contentHash: sha256(compact) });
      publicContacts.push(...extractPublicContacts(url, compact, document.links ?? []));
      const result = parsePageAnalysisPayload(await analyzer({ url, title, markdown: compact }));
      if (!result.relevant) continue;
      if (result.communicationName) communicationNameCandidates.push({
        value: result.communicationName,
        confidence: result.communicationNameConfidence,
        evidence: result.communicationNameEvidence,
        sourceUrl: url,
      });
      if (result.summary) summaries.push(result.summary);
      for (const fact of result.facts) {
        if (!fact.sensitive && fact.confidence >= 0.55) facts.push({
          category: fact.category, value: fact.value, evidence: fact.evidence,
          confidence: fact.confidence, sourceUrl: url,
        });
      }
    }

    const uniqueFacts = dedupeFacts(facts);
    const communicationName = selectSiteCommunicationName(communicationNameCandidates, company.domain);
    const intelligence: CompanySiteIntelligenceData = {
      schemaVersion: 1,
      analysisRevision: SITE_INTELLIGENCE_ANALYSIS_REVISION,
      summary: summaries.join(" ").slice(0, 1800),
      facts: uniqueFacts.slice(0, 40),
      personalizationHooks: rankHooks(uniqueFacts).slice(0, 3),
      publicContacts: dedupePublicContacts(publicContacts),
      communicationName,
    };
    const analyzedAt = now;
    const saved = await prisma.companySiteIntelligence.update({
      where: { companyId },
      data: {
        status: "READY", provider: "firecrawl", pages: pages as Prisma.InputJsonValue,
        intelligence: intelligence as Prisma.InputJsonValue,
        contentHash: sha256(pages.map((page) => page.contentHash).join(":")),
        creditsUsed: documents.length, analyzedAt,
        expiresAt: new Date(analyzedAt.getTime() + SITE_INTELLIGENCE_TTL_DAYS * 86_400_000), error: null,
      },
    });
    await persistCommunicationName(prisma, company.id, communicationName, analyzedAt);
    return saved;
  } catch (error) {
    await prisma.companySiteIntelligence.update({
      where: { companyId }, data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) },
    });
    throw error;
  }
}

/** Site evidence is the only automatic source for a name used in outreach. */
export function selectSiteCommunicationName(candidates: CommunicationNameCandidate[], domain?: string | null) {
  return candidates
    .map((candidate) => ({ ...candidate, value: cleanCommunicationName(candidate.value) }))
    .filter((candidate) => isUsableCommunicationName(candidate, domain))
    .sort((a, b) => b.confidence - a.confidence || b.evidence.length - a.evidence.length)[0] ?? null;
}

/** Conservative migration path for site pages analyzed before the dedicated name field existed. */
export function communicationNameFromIdentityFact(fact: {
  value: string; evidence: string; confidence: number; sourceUrl: string;
}): CommunicationNameCandidate | null {
  if (fact.confidence < COMMUNICATION_NAME_MIN_CONFIDENCE) return null;
  const value = fact.value.trim();
  const quoted = value.match(/(?:ООО|АО|ПАО|ОАО|ЗАО|ИП|компани(?:я|и)|фирма)\s*[«“„\"']([^»”\"']{2,100})[»”\"']/i)?.[1];
  const named = value.match(/^Компания\s+(?:называется\s+)?([\p{L}\p{N}][\p{L}\p{N}.&+ -]{1,70}?)(?=\s+(?:—|-|и\s+имеет|специализируется|является|разрабатывает|создаёт|создает)\b)/iu)?.[1];
  const prefix = value.match(/^([\p{L}\p{N}Öö][\p{L}\p{N}Öö.&+ -]{1,60}?)(?:\s+\([^)]{2,40}\))?\s+[—–-]\s+/u)?.[1];
  const candidate = prefix || quoted || named;
  if (!candidate || /^(?:компания|группа компаний|общество с ограниченной ответственностью|основной вид деятельности|контактные данные|юридический адрес|реквизиты|код ит-деятельности)$/i.test(candidate.trim())) return null;
  return { value: candidate.trim(), evidence: fact.evidence, confidence: fact.confidence, sourceUrl: fact.sourceUrl };
}

function cleanCommunicationName(value: string) {
  return value.trim()
    .replace(/^[«“„\"']+|[»”\"']+$/g, "")
    .replace(/^(?:ООО|АО|ПАО|ОАО|ЗАО|ИП)\s+[«“„\"']?/i, "")
    .replace(/[»”\"']+$/g, "")
    .trim();
}

function isUsableCommunicationName(candidate: CommunicationNameCandidate, domain?: string | null) {
  const value = candidate.value.trim();
  if (candidate.confidence < COMMUNICATION_NAME_MIN_CONFIDENCE || candidate.evidence.trim().length < 3) return false;
  if (value.length < 2 || value.length > 100 || /https?:|@|\.(?:ru|рф|com|io|net|org)\b/i.test(value)) return false;
  if (/^(?:о компании|компания|главная|официальный сайт|информация о компании|не найдено)$/i.test(value)) return false;
  const normalizedDomain = domain?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return !normalizedDomain || value.toLowerCase().replace(/^www\./, "") !== normalizedDomain;
}

async function persistCommunicationName(
  prisma: PrismaClient,
  companyId: string,
  candidate: CommunicationNameCandidate | null,
  updatedAt: Date,
) {
  await prisma.company.update({
    where: { id: companyId },
    data: candidate ? {
      communicationName: candidate.value,
      communicationNameConfidence: candidate.confidence,
      communicationNameSource: candidate.sourceUrl,
      communicationNameEvidence: candidate.evidence,
      communicationNameUpdatedAt: updatedAt,
    } : {
      communicationName: null,
      communicationNameConfidence: null,
      communicationNameSource: null,
      communicationNameEvidence: null,
      communicationNameUpdatedAt: updatedAt,
    },
  });
}

export function extractPublicContacts(sourceUrl: string, markdown: string, links: string[]) {
  const result: CompanySiteIntelligenceData["publicContacts"] = [];
  const emails = new Set(markdown.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []);
  for (const link of links) if (link.toLowerCase().startsWith("mailto:")) emails.add(link.slice(7).split("?")[0]);
  for (const email of emails) {
    const normalized = email.toLowerCase();
    result.push({ kind: "email", value: normalized, sourceUrl, generic: /^(info|hello|contact|sales|support|office|mail|admin|team)@/i.test(normalized) });
  }
  for (const raw of links) {
    let url: URL;
    try { url = new URL(raw, sourceUrl); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const kind = host === "t.me" || host === "telegram.me" ? "telegram"
      : host === "linkedin.com" ? "linkedin"
      : host === "vk.com" ? "vk"
      : host === "wa.me" || host === "api.whatsapp.com" ? "whatsapp" : null;
    if (kind) result.push({ kind, value: url.toString(), sourceUrl, generic: true });
  }
  return result;
}

function metadataTitle(metadata?: Record<string, unknown>) {
  const value = metadata?.title ?? metadata?.ogTitle;
  return typeof value === "string" ? value.slice(0, 300) : "";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function dedupeFacts(facts: CompanySiteIntelligenceData["facts"]) {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.category}:${fact.value.toLocaleLowerCase("ru-RU").replace(/\W+/g, " ").trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupePublicContacts(contacts: CompanySiteIntelligenceData["publicContacts"]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const key = `${contact.kind}:${contact.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankHooks(facts: CompanySiteIntelligenceData["facts"]) {
  const categoryWeight: Record<string, number> = { differentiator: 6, product: 5, proof: 3, offer: 2, geography: 1 };
  return [...facts]
    .filter((fact) => fact.confidence >= 0.65 && fact.evidence.length >= 8)
    .sort((a, b) => hookScore(b, categoryWeight) - hookScore(a, categoryWeight));
}

function hookScore(fact: CompanySiteIntelligenceData["facts"][number], categoryWeight: Record<string, number>) {
  const signalPageBonus = /\/(?:news|press|blog|cases?|projects?|новости|кейсы|проекты)(?:\/|$)/i.test(new URL(fact.sourceUrl).pathname) ? 5 : 0;
  return (categoryWeight[fact.category] ?? 0) + fact.confidence + signalPageBonus;
}
