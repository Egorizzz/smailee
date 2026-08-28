import { Prisma, type PrismaClient } from "@prisma/client";
import { analyzeCompanySite, companySiteIntelligenceSchema } from "./siteIntelligence";
import { ensureCompanyDataSource, ingestProviderCompanies } from "./repository";
import type { CompanyDataProvider, ProviderCompany, ProviderPage, ProviderUsage } from "./types";
import type { HunterPersonQuery, HunterPersonResult, HunterQuery, HunterVerificationResult } from "./providers/hunter";
import type { ReoonVerificationResult } from "./providers/reoon";
import { decideEmailVerification, verificationState } from "./emailVerification";
import { cachedExternalOperation } from "./operationCache";
import { candidateEmailsForPerson, transliterateName } from "./emailPatterns";
import { hunterDepartmentsForRoles, roleMatchesPreference } from "./prospectingCatalog";
import { evaluateCompanyTraits } from "./companyTraits";
import { businessDomainFromEmails } from "./domainInference";

type HunterLike = CompanyDataProvider<HunterQuery> & {
  findPerson(query: HunterPersonQuery): Promise<HunterPersonResult>;
  verifyEmail(email: string): Promise<HunterVerificationResult>;
};
type ReoonLike = { key: string; name: string; capabilities: Record<string, unknown>; verifyEmail(email: string): Promise<ReoonVerificationResult> };
type SiteAnalyzer = typeof analyzeCompanySite;

export type ProspectingPipelineLimits = {
  maxCheckoRequests?: number;
  maxFirecrawlPages?: number;
  maxHunterCredits?: number;
  maxReoonCredits?: number;
};

export type ProspectingPipelineResult = {
  target: number;
  complete: boolean;
  selected: number;
  processed: number;
  accepted: number;
  acceptedCompanies: number;
  rejected: number;
  rows: Array<{
    companyId: string; name?: string; inn?: string; domain?: string;
    contacts: Array<{ email: string; kind: string; source: string; role?: string; name?: string; verificationState: string }>;
    personalizationHooks: Array<{ value: string; evidence: string; sourceUrl: string; confidence: number }>;
  }>;
  outcomes: Array<{
    companyId: string; position: number; status: "ACCEPTED" | "REJECTED";
    selectedEmail?: string; selectedEmails: string[]; rejectionReason?: string;
    personalizationHooks: Array<{ value: string; evidence: string; sourceUrl: string; confidence: number }>;
  }>;
  usage: {
    datanewton: ProviderUsage & { records: number };
    checko: ProviderUsage;
    firecrawl: { pages: number };
    hunter: ProviderUsage;
    reoon: ProviderUsage;
    cache: { hits: number; misses: number };
    llm: { pagesAnalyzed: number; inputCharacters: number };
  };
};

type ContactObservation = { source: string; sourceUrl?: string };
type ContactCandidate = {
  email: string; kind: string; source: string; role?: string; name?: string; confidence: number;
  sourceUrl?: string; verificationStatus?: string; observations?: ContactObservation[];
};

export async function runProspectingPipeline<Query>(input: {
  prisma: PrismaClient;
  selector: CompanyDataProvider<Query>;
  verifier: CompanyDataProvider<unknown>;
  hunter: HunterLike;
  reoon?: ReoonLike;
  query: Query;
  target?: number;
  maxCandidates?: number;
  siteAnalyzer?: SiteAnalyzer;
  limits?: ProspectingPipelineLimits;
  verificationPolicy?: { allowAcceptAll: boolean; minAcceptAllScore: number };
  shouldStop?: () => Promise<boolean>;
  excludeEmails?: ReadonlySet<string>;
  onOutcome?: (outcome: ProspectingPipelineResult["outcomes"][number], progress: { processed: number; accepted: number }) => Promise<void>;
  onIssue?: (issue: { companyId?: string; stage: string; provider?: string; code: string; message: string; retryable: boolean }) => Promise<void>;
}): Promise<ProspectingPipelineResult> {
  const target = Math.min(Math.max(input.target ?? 500, 1), 10_000);
  const maxCandidates = Math.min(Math.max(input.maxCandidates ?? Math.ceil(target / 4), 1), 40_000);
  const desiredRoles = queryStringArray(input.query, "desired_roles");
  const requiredTraits = queryStringArray(input.query, "keywords");
  const excludedTraits = queryStringArray(input.query, "exclude_company_traits");
  const desiredDepartments = hunterDepartmentsForRoles(desiredRoles);
  const siteAnalyzer = input.siteAnalyzer ?? analyzeCompanySite;
  const limits = input.limits ?? {};
  const policy = input.verificationPolicy ?? { allowAcceptAll: false, minAcceptAllScore: 85 };
  await ensureCompanyDataSource(input.prisma, { key: input.selector.key, name: input.selector.name, capabilities: input.selector.capabilities, priority: 20 });
  await ensureCompanyDataSource(input.prisma, { key: input.verifier.key, name: input.verifier.name, capabilities: input.verifier.capabilities, priority: 30 });
  await ensureCompanyDataSource(input.prisma, { key: input.hunter.key, name: input.hunter.name, capabilities: input.hunter.capabilities, priority: 40 });
  if (input.reoon) await ensureCompanyDataSource(input.prisma, { key: input.reoon.key, name: input.reoon.name, capabilities: input.reoon.capabilities as never, priority: 50 });

  const usage: ProspectingPipelineResult["usage"] = {
    datanewton: { requests: 0, credits: 0, records: 0 }, checko: { requests: 0, credits: 0 },
    firecrawl: { pages: 0 }, hunter: { requests: 0, credits: 0, creditsEstimated: true },
    reoon: { requests: 0, credits: 0, creditsEstimated: true }, cache: { hits: 0, misses: 0 },
    llm: { pagesAnalyzed: 0, inputCharacters: 0 },
  };
  const selectorQuery = withoutLocalProspectingFields(input.query);
  const selectionCached = await cachedExternalOperation({
    prisma: input.prisma, provider: input.selector.key, operation: "search", params: { query: selectorQuery, maxCandidates },
    execute: () => loadCandidates(input.selector, selectorQuery, maxCandidates),
    usage: (value) => value.usage,
  });
  countCache(usage, selectionCached.cacheHit);
  const selectedCompanies = reviveCompanies(selectionCached.value.items);
  if (input.selector.key === "checko") {
    usage.checko.requests += selectionCached.requests;
    usage.checko.credits = (usage.checko.credits ?? 0) + selectionCached.credits;
  } else {
    usage.datanewton.requests += selectionCached.requests;
    usage.datanewton.credits = (usage.datanewton.credits ?? 0) + selectionCached.credits;
    usage.datanewton.records = selectedCompanies.length;
  }
  const ingested = await ingestProviderCompanies(input.prisma, input.selector.key, selectedCompanies);
  const rows: ProspectingPipelineResult["rows"] = [];
  const outcomes: ProspectingPipelineResult["outcomes"] = [];
  let processed = 0;
  let acceptedContacts = 0;
  const recordOutcome = async (outcome: ProspectingPipelineResult["outcomes"][number]) => {
    outcomes.push(outcome);
    await input.onOutcome?.(outcome, { processed, accepted: acceptedContacts });
  };
  const recordIssue = async (issue: Parameters<NonNullable<typeof input.onIssue>>[0]) => input.onIssue?.(issue);
  const standardEnrichments = new Set<Promise<void>>();
  let reservedFirecrawlPages = 0;

  const scheduleStandardEnrichment = async (params: {
    companyId: string;
    domain: string;
    row: ProspectingPipelineResult["rows"][number];
    outcome: ProspectingPipelineResult["outcomes"][number];
    accepted: ContactCandidate[];
  }) => {
    const availablePages = (limits.maxFirecrawlPages ?? Infinity) - usage.firecrawl.pages - reservedFirecrawlPages;
    if (availablePages <= 0) return;
    const pageReservation = Math.min(2, availablePages);
    reservedFirecrawlPages += pageReservation;
    const task = (async () => {
      try {
        const site = await siteAnalyzer(input.prisma, params.companyId, { maxPages: pageReservation });
        usage.firecrawl.pages += site.creditsUsed;
        const intelligence = companySiteIntelligenceSchema.parse(site.intelligence);
        params.row.personalizationHooks = intelligence.personalizationHooks;
        params.outcome.personalizationHooks = intelligence.personalizationHooks;
        const pages = Array.isArray(site.pages) ? site.pages as Array<{ characters?: unknown }> : [];
        usage.llm.pagesAnalyzed += pages.length;
        usage.llm.inputCharacters += pages.reduce((sum, page) => sum + (typeof page.characters === "number" ? page.characters : 0), 0);
        for (const publicContact of intelligence.publicContacts) {
          if (publicContact.kind !== "email" || !emailMatchesDomain(publicContact.value, params.domain)) continue;
          const candidate: ContactCandidate = { email: publicContact.value, kind: publicContact.generic ? "generic" : "personal", source: "website", sourceUrl: publicContact.sourceUrl, confidence: 0.85 };
          const existing = params.accepted.find((item) => item.email === candidate.email);
          if (existing) {
            existing.observations = [...(existing.observations ?? [{ source: existing.source, sourceUrl: existing.sourceUrl }]), { source: candidate.source, sourceUrl: candidate.sourceUrl }];
            await saveContact(input.prisma, params.companyId, existing);
            continue;
          }
          if (!await verifyAndSave(input, params.companyId, candidate, usage, limits, policy)) continue;
          params.accepted.push(candidate);
          acceptedContacts++;
          params.row.contacts.push({ email: candidate.email, kind: candidate.kind, source: candidate.source, role: candidate.role, name: candidate.name, verificationState: contactVerificationState(candidate.verificationStatus) });
          params.outcome.selectedEmails.push(candidate.email);
        }
        // Контакт уже сохранён сразу после поиска. Второй вызов только дополняет
        // карточку результатами параллельного анализа сайта.
        await input.onOutcome?.(params.outcome, { processed, accepted: acceptedContacts });
      } catch (error) {
        if (!isExpectedMissingSite(error)) await recordIssue({ companyId: params.companyId, stage: "site_analysis", provider: "firecrawl", code: "CNT-1301", message: error instanceof Error ? error.message : String(error), retryable: true });
      } finally {
        reservedFirecrawlPages -= pageReservation;
      }
    })();
    standardEnrichments.add(task);
    void task.finally(() => standardEnrichments.delete(task));
    if (standardEnrichments.size >= 4) await Promise.race(standardEnrichments);
  };

  for (let index = 0; index < selectedCompanies.length && acceptedContacts < target; index++) {
    if (input.shouldStop && await input.shouldStop()) break;
    const selected = selectedCompanies[index];
    const companyId = ingested[index].companyId;
    processed++;
    let verified: ProviderCompany | undefined;
    const registryId = selected.identity?.inn ?? selected.identity?.ogrn;
    if (registryId && companyNeedsRegistryVerification(selected) && usage.checko.requests < (limits.maxCheckoRequests ?? Infinity) && input.verifier.getByIds) {
      try {
        const cached = await cachedExternalOperation({
          prisma: input.prisma, provider: input.verifier.key, operation: "getById", params: { registryId },
          execute: async () => (await input.verifier.getByIds!([registryId]))[0] ?? null,
        });
        countCache(usage, cached.cacheHit); usage.checko.requests += cached.requests;
        verified = cached.value ? reviveCompany(cached.value) : undefined;
        if (verified) await ingestProviderCompanies(input.prisma, input.verifier.key, [verified]);
      } catch (error) { usage.checko.requests++; await recordIssue({ companyId, stage: "company_verification", provider: input.verifier.key, code: "SRC-2111", message: error instanceof Error ? error.message : String(error), retryable: true }); }
    }
    if (verified && isInactive(verified.status)) {
      await recordOutcome({ companyId, position: index, status: "REJECTED", selectedEmails: [], rejectionReason: "company_inactive", personalizationHooks: [] });
      continue;
    }

    let domain = normalizedDomain(verified) ?? normalizedDomain(selected);
    const contacts = new Map<string, ContactCandidate>();
    const storedContacts = await input.prisma.companyProspectContact.findMany({
      where: { companyId },
      orderBy: [{ verifiedAt: "desc" }, { confidence: "desc" }, { observedAt: "desc" }],
      take: 50,
    });
    for (const stored of storedContacts) putContact(contacts, {
      email: stored.email,
      kind: stored.kind,
      name: stored.name ?? undefined,
      role: stored.role ?? undefined,
      source: stored.source,
      sourceUrl: stored.sourceUrl ?? undefined,
      confidence: stored.confidence,
      verificationStatus: stored.verificationStatus ?? undefined,
    });
    addProviderEmails(contacts, selected, input.selector.key, domain);
    if (verified) addProviderEmails(contacts, verified, input.verifier.key, domain);
    if (!domain) {
      domain = businessDomainFromEmails([...contacts.keys()]);
      if (domain) {
        await input.prisma.company.update({
          where: { id: companyId },
          data: { domain, website: `https://${domain}` },
        });
      }
    }

    const requiresDeepSiteCheck = requiredTraits.length > 0 || excludedTraits.length > 0;
    let standardSiteAnalyzed = false;
    let hooks: ProspectingPipelineResult["rows"][number]["personalizationHooks"] = [];
    let siteIntelligence: ReturnType<typeof companySiteIntelligenceSchema.parse> | undefined;
    const remainingPages = (limits.maxFirecrawlPages ?? Infinity) - usage.firecrawl.pages;
    if (requiresDeepSiteCheck && domain && remainingPages > 0) {
      try {
        const site = await siteAnalyzer(input.prisma, companyId, { maxPages: Math.min(3, remainingPages) });
        usage.firecrawl.pages += site.creditsUsed;
        const intelligence = companySiteIntelligenceSchema.parse(site.intelligence);
        siteIntelligence = intelligence;
        const pages = Array.isArray(site.pages) ? site.pages as Array<{ characters?: unknown }> : [];
        usage.llm.pagesAnalyzed += pages.length;
        usage.llm.inputCharacters += pages.reduce((sum, page) => sum + (typeof page.characters === "number" ? page.characters : 0), 0);
        hooks = intelligence.personalizationHooks;
        for (const contact of intelligence.publicContacts) {
          if (contact.kind !== "email" || !emailMatchesDomain(contact.value, domain)) continue;
          putContact(contacts, { email: contact.value, kind: contact.generic ? "generic" : "personal", source: "website", sourceUrl: contact.sourceUrl, confidence: 0.85 });
        }
      } catch (error) { if (!isExpectedMissingSite(error)) await recordIssue({ companyId, stage: "site_analysis", provider: "firecrawl", code: "CNT-1301", message: error instanceof Error ? error.message : String(error), retryable: true }); }
    }

    if (requiredTraits.length || excludedTraits.length) {
      if (!siteIntelligence) {
        await persistDiscoveredContacts(input.prisma, companyId, contacts);
        await recordOutcome({ companyId, position: index, status: "REJECTED", selectedEmails: [], rejectionReason: "site_traits_unavailable", personalizationHooks: hooks });
        continue;
      }
      const traits = evaluateCompanyTraits(siteIntelligence, requiredTraits, excludedTraits);
      if (traits.matchedExcluded.length) {
        await persistDiscoveredContacts(input.prisma, companyId, contacts);
        await recordOutcome({ companyId, position: index, status: "REJECTED", selectedEmails: [], rejectionReason: `excluded_trait:${traits.matchedExcluded.join("|")}`, personalizationHooks: hooks });
        continue;
      }
      if (traits.missingRequired.length) {
        await persistDiscoveredContacts(input.prisma, companyId, contacts);
        await recordOutcome({ companyId, position: index, status: "REJECTED", selectedEmails: [], rejectionReason: `required_trait_not_confirmed:${traits.missingRequired.join("|")}`, personalizationHooks: hooks });
        continue;
      }
    }

    let hunterPage: ProviderPage | undefined;
    if (domain && (usage.hunter.credits ?? 0) < (limits.maxHunterCredits ?? Infinity)) {
      try {
        const hunterQuery: HunterQuery = {
          domains: [domain], limitPerDomain: 10,
          department: desiredDepartments.length ? desiredDepartments.join(",") : undefined,
          seniority: desiredRoles.length ? "executive,senior" : undefined,
          decisionMaker: desiredRoles.length ? true : undefined,
          requiredField: desiredRoles.length ? "full_name,position" : undefined,
        };
        const cached = await cachedExternalOperation({
          prisma: input.prisma, provider: input.hunter.key, operation: "domainSearch", params: { domain, ...hunterQuery },
          execute: () => input.hunter.search(hunterQuery), usage: (value) => value.usage,
        });
        countCache(usage, cached.cacheHit); addUsage(usage.hunter, { requests: cached.requests, credits: cached.credits });
        hunterPage = revivePage(cached.value);
        for (const contact of hunterContacts(hunterPage.items[0])) putContact(contacts, contact);
        if (hunterPage.items.length) await ingestProviderCompanies(input.prisma, input.hunter.key, hunterPage.items);
      } catch (error) { await recordIssue({ companyId, stage: "domain_search", provider: input.hunter.key, code: "SRC-2121", message: error instanceof Error ? error.message : String(error), retryable: true }); }
    }

    const leader = fieldString(verified ?? selected, "leader_name") ?? fieldString(selected, "leader_name");
    const person = leader ? parseRussianName(leader) : undefined;
    const hunterKnown = hunterContactsDetailed(hunterPage?.items[0]);
    let leaderCovered = person ? hunterKnown.some((item) => samePerson(item, person)) : true;
    if (domain && person && !leaderCovered) {
      const pattern = hunterPattern(hunterPage?.items[0]);
      for (const email of candidateEmailsForPerson({ person, domain, providerPattern: pattern, knownContacts: hunterKnown })) {
        putContact(contacts, { email, kind: "person", name: `${person.firstName} ${person.lastName}`, role: "Руководитель", source: "pattern", confidence: 0.72 });
      }
    }

    const accepted: ContactCandidate[] = [];
    for (const contact of [...contacts.values()].sort((a, b) => contactScore(b, desiredRoles) - contactScore(a, desiredRoles))) {
      if (input.excludeEmails?.has(contact.email.toLowerCase())) continue;
      const decision = await verifyAndSave(input, companyId, contact, usage, limits, policy);
      if (decision) accepted.push(contact);
    }

    if (domain && person && !leaderCovered && !accepted.some((item) => item.name && samePersonName(item.name, person))) {
      for (const variant of uniqueNameVariants(person)) {
        if ((usage.hunter.credits ?? 0) >= (limits.maxHunterCredits ?? Infinity)) break;
        try {
          const cached = await cachedExternalOperation({
            prisma: input.prisma, provider: input.hunter.key, operation: "emailFinder", params: { domain, ...variant },
            execute: () => input.hunter.findPerson({ domain, ...variant }), usage: (value) => value.usage,
          });
          countCache(usage, cached.cacheHit); addUsage(usage.hunter, { requests: cached.requests, credits: cached.credits });
          const found = cached.value;
          if (!found.email) continue;
          if (input.excludeEmails?.has(found.email.toLowerCase())) { leaderCovered = true; break; }
          const candidate: ContactCandidate = {
            email: found.email, kind: "person", name: `${person.firstName} ${person.lastName}`,
            source: "hunter_finder", role: found.position ?? "Руководитель", confidence: (found.score ?? 70) / 100,
            verificationStatus: found.verificationStatus,
          };
          putContact(contacts, candidate);
          if (await verifyAndSave(input, companyId, candidate, usage, limits, policy)) accepted.push(candidate);
          leaderCovered = true;
          break;
        } catch { /* Preserve failed lookup in operation cache on a later iteration only after expiry. */ }
      }
    }

    const uniqueAccepted = [...new Map(accepted.map((item) => [item.email, item])).values()];
    if (!uniqueAccepted.length && !requiresDeepSiteCheck && domain && remainingPages > 0) {
      // Сайт остаётся резервным источником контакта, если реестр и поиск по
      // домену ничего не дали. Берём только главную страницу: это быстрее и
      // дешевле полного персонализационного анализа.
      try {
        const site = await siteAnalyzer(input.prisma, companyId, { maxPages: 1 });
        standardSiteAnalyzed = true;
        usage.firecrawl.pages += site.creditsUsed;
        const intelligence = companySiteIntelligenceSchema.parse(site.intelligence);
        hooks = intelligence.personalizationHooks;
        const pages = Array.isArray(site.pages) ? site.pages as Array<{ characters?: unknown }> : [];
        usage.llm.pagesAnalyzed += pages.length;
        usage.llm.inputCharacters += pages.reduce((sum, page) => sum + (typeof page.characters === "number" ? page.characters : 0), 0);
        for (const publicContact of intelligence.publicContacts) {
          if (publicContact.kind !== "email" || !emailMatchesDomain(publicContact.value, domain)) continue;
          const candidate: ContactCandidate = { email: publicContact.value, kind: publicContact.generic ? "generic" : "personal", source: "website", sourceUrl: publicContact.sourceUrl, confidence: 0.85 };
          if (await verifyAndSave(input, companyId, candidate, usage, limits, policy)) uniqueAccepted.push(candidate);
        }
      } catch (error) { if (!isExpectedMissingSite(error)) await recordIssue({ companyId, stage: "site_contact_fallback", provider: "firecrawl", code: "CNT-1302", message: error instanceof Error ? error.message : String(error), retryable: true }); }
    }
    if (!uniqueAccepted.length) {
      await recordOutcome({ companyId, position: index, status: "REJECTED", selectedEmails: [], rejectionReason: contacts.size ? "no_acceptable_verified_email" : "email_not_found", personalizationHooks: hooks });
      continue;
    }
    acceptedContacts += uniqueAccepted.length;
    const row: ProspectingPipelineResult["rows"][number] = {
      companyId, name: selected.displayName ?? selected.legalName, inn: selected.identity?.inn, domain,
      contacts: uniqueAccepted.map((item) => ({ email: item.email, kind: item.kind, source: item.source, role: item.role, name: item.name, verificationState: contactVerificationState(item.verificationStatus) })),
      personalizationHooks: hooks,
    };
    const outcome: ProspectingPipelineResult["outcomes"][number] = { companyId, position: index, status: "ACCEPTED", selectedEmail: uniqueAccepted[0].email, selectedEmails: uniqueAccepted.map((item) => item.email), personalizationHooks: hooks };
    rows.push(row);
    await recordOutcome(outcome);
    if (!requiresDeepSiteCheck && !standardSiteAnalyzed && domain) await scheduleStandardEnrichment({ companyId, domain, row, outcome, accepted: uniqueAccepted });
  }

  await Promise.all(standardEnrichments);

  return {
    target, complete: acceptedContacts >= target, selected: selectedCompanies.length, processed,
    accepted: acceptedContacts, acceptedCompanies: rows.length, rejected: processed - rows.length,
    rows, outcomes, usage,
  };
}

async function verifyAndSave<Query>(
  input: Parameters<typeof runProspectingPipeline<Query>>[0], companyId: string, contact: ContactCandidate,
  usage: ProspectingPipelineResult["usage"], limits: ProspectingPipelineLimits,
  policy: { allowAcceptAll: boolean; minAcceptAllScore: number },
) {
  const embedded = contact.verificationStatus?.toLowerCase();
  if (embedded === "valid") {
    await saveContact(input.prisma, companyId, contact, { status: "valid", score: Math.round(contact.confidence * 100) }, "hunter");
    return true;
  }
  let result: HunterVerificationResult | ReoonVerificationResult | undefined;
  let source = "hunter";
  if (input.reoon && (usage.reoon.credits ?? 0) < (limits.maxReoonCredits ?? Infinity)) {
    try {
      const cached = await cachedExternalOperation({
        prisma: input.prisma, provider: input.reoon.key, operation: "verifyEmail", params: { email: contact.email },
        execute: () => input.reoon!.verifyEmail(contact.email), usage: (value) => value.usage,
      });
      countCache(usage, cached.cacheHit); addUsage(usage.reoon, { requests: cached.requests, credits: cached.credits });
      result = cached.value; source = "reoon";
    } catch { /* Hunter fallback below. */ }
  }
  if (!result || result.status === "unknown" || result.status === "pending") {
    if ((usage.hunter.credits ?? 0) + 0.5 <= (limits.maxHunterCredits ?? Infinity)) {
      try {
        const cached = await cachedExternalOperation({
          prisma: input.prisma, provider: input.hunter.key, operation: "verifyEmail", params: { email: contact.email },
          execute: () => input.hunter.verifyEmail(contact.email), usage: (value) => value.usage,
        });
        countCache(usage, cached.cacheHit); addUsage(usage.hunter, { requests: cached.requests, credits: cached.credits });
        result = cached.value; source = "hunter";
      } catch { /* Save unverified below. */ }
    }
  }
  if (!result) { await saveContact(input.prisma, companyId, contact); return false; }
  const decision = decideEmailVerification(result, policy);
  contact.verificationStatus = result.status;
  await saveContact(input.prisma, companyId, contact, result, source);
  return decision.action === "accept";
}

async function loadCandidates<Query>(provider: CompanyDataProvider<Query>, query: Query, maxCandidates: number) {
  const items: ProviderCompany[] = []; const seen = new Set<string>(); const usage: ProviderUsage = { requests: 0, credits: 0 };
  while (items.length < maxCandidates) {
    const limit = Math.min(provider.key === "checko" ? 40_000 : 500, maxCandidates - items.length);
    const pageQuery = query && typeof query === "object" && !Array.isArray(query) ? { ...query, limit, offset: items.length } as Query : query;
    const page = await provider.search(pageQuery); addUsage(usage, page.usage);
    for (const company of page.items) {
      const key = `${company.identity?.inn ?? ""}:${company.identity?.ogrn ?? ""}:${company.externalId}`;
      if (!seen.has(key)) { seen.add(key); items.push(company); }
      if (items.length >= maxCandidates) break;
    }
    if (page.items.length < limit || page.items.length === 0) break;
  }
  return { items, usage };
}

function reviveCompanies(items: ProviderCompany[]) { return items.map(reviveCompany); }
function reviveCompany(company: ProviderCompany) {
  return { ...company, sourceUpdatedAt: typeof company.sourceUpdatedAt === "string" ? new Date(company.sourceUpdatedAt) : company.sourceUpdatedAt } as ProviderCompany;
}
function revivePage(page: ProviderPage): ProviderPage { return { ...page, items: reviveCompanies(page.items) }; }
function countCache(usage: ProspectingPipelineResult["usage"], hit: boolean) { hit ? usage.cache.hits++ : usage.cache.misses++; }
function normalizedDomainValue(raw?: string) { if (!raw) return undefined; try { return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return undefined; } }
function normalizedDomain(company?: ProviderCompany) { return normalizedDomainValue(company?.identity?.domain ?? company?.website); }
function fieldString(company: ProviderCompany, key: string) { const value = company.fields?.[key]; return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function providerEmails(company: ProviderCompany) { const value = company.fields?.company_emails; return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.includes("@")).map((item) => item.toLowerCase()) : []; }

/**
 * DataNewton is the primary selector. Checko is requested only when its registry
 * card can resolve a material gap or conflict before downstream enrichment.
 */
export function companyNeedsRegistryVerification(company: ProviderCompany) {
  const domain = normalizedDomain(company);
  const identityDomain = normalizedDomainValue(company.identity?.domain);
  const websiteDomain = normalizedDomainValue(company.website);
  const emails = providerEmails(company);
  const status = company.status?.trim();
  if (!status || /^(?:unknown|n\/a|неизвестно|не определ(?:ен|ён|ено))$/i.test(status)) return true;
  if (!domain) return true;
  if (identityDomain && websiteDomain && identityDomain !== websiteDomain) return true;
  if (!fieldString(company, "leader_name")) return true;
  if (!emails.length) return true;
  return !emails.some((email) => emailMatchesDomain(email, domain));
}

function addProviderEmails(target: Map<string, ContactCandidate>, company: ProviderCompany, source: string, domain?: string) { for (const email of providerEmails(company)) { if (domain && !emailMatchesDomain(email, domain)) continue; putContact(target, { email, kind: roleEmail(email) ? "generic" : "unknown", source, confidence: domain ? 0.8 : 0.6 }); } }
function putContact(target: Map<string, ContactCandidate>, contact: ContactCandidate) {
  const normalized = contact.email.trim().toLowerCase(); if (!normalized.includes("@")) return;
  const next = { ...contact, email: normalized }; const existing = target.get(normalized);
  if (!existing) { target.set(normalized, { ...next, observations: [{ source: next.source, sourceUrl: next.sourceUrl }] }); return; }
  const preferred = contactScore(next) > contactScore(existing) ? next : existing;
  const observations = [...(existing.observations ?? []), { source: next.source, sourceUrl: next.sourceUrl }].filter((item, index, all) => all.findIndex((other) => other.source === item.source && other.sourceUrl === item.sourceUrl) === index);
  target.set(normalized, { ...preferred, observations });
}
function emailMatchesDomain(email: string, domain: string) { const emailDomain = email.split("@")[1]?.toLowerCase(); return emailDomain === domain || emailDomain?.endsWith(`.${domain}`); }
function roleEmail(email: string) { return /^(info|hello|contact|sales|support|office|mail|admin|team|marketing|hr|manager|service)@/i.test(email); }
function isInactive(status?: string) { return Boolean(status && /(ликвид|прекращ|inactive|closed|dissolved)/i.test(status)); }
function parseRussianName(value: string) { const parts = value.trim().split(/\s+/); if (parts.length < 2) return undefined; return { lastName: titleCase(parts[0]), firstName: titleCase(parts[1]) }; }
function titleCase(value: string) { return value.toLocaleLowerCase("ru-RU").replace(/(^|[-\s])\p{L}/gu, (letter) => letter.toLocaleUpperCase("ru-RU")); }
function uniqueNameVariants(name: { firstName: string; lastName: string }) {
  const latin = {
    firstName: transliterateName(name.firstName),
    lastName: transliterateName(name.lastName),
  };
  return latin.firstName && latin.lastName && (latin.firstName !== name.firstName || latin.lastName !== name.lastName)
    ? [name, latin]
    : [name];
}
function samePerson(contact: { firstName?: string; lastName?: string }, person: { firstName: string; lastName: string }) { return contact.firstName?.toLocaleLowerCase("ru-RU") === person.firstName.toLocaleLowerCase("ru-RU") && contact.lastName?.toLocaleLowerCase("ru-RU") === person.lastName.toLocaleLowerCase("ru-RU"); }
function samePersonName(value: string, person: { firstName: string; lastName: string }) { const normalized = value.toLocaleLowerCase("ru-RU"); return normalized.includes(person.firstName.toLocaleLowerCase("ru-RU")) && normalized.includes(person.lastName.toLocaleLowerCase("ru-RU")); }
function hunterPattern(company?: ProviderCompany) { const value = company?.fields?.hunter_pattern; return typeof value === "string" ? value : undefined; }
function hunterContactsDetailed(company?: ProviderCompany) {
  const value = company?.fields?.hunter_emails; if (!Array.isArray(value)) return [];
  return value.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && typeof item.email === "string" ? [{ email: item.email.toLowerCase(), firstName: typeof item.first_name === "string" ? item.first_name : undefined, lastName: typeof item.last_name === "string" ? item.last_name : undefined }] : []);
}
function hunterContacts(company?: ProviderCompany): ContactCandidate[] {
  const value = company?.fields?.hunter_emails; if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.email !== "string") return [];
    const firstName = typeof item.first_name === "string" ? item.first_name : undefined; const lastName = typeof item.last_name === "string" ? item.last_name : undefined;
    return [{ email: item.email.toLowerCase(), kind: item.type === "personal" ? "person" : "generic", name: [firstName, lastName].filter(Boolean).join(" ") || undefined, source: "hunter_domain", role: typeof item.position === "string" ? item.position : undefined, confidence: typeof item.confidence === "number" ? item.confidence / 100 : 0.7, verificationStatus: typeof item.verification_status === "string" ? item.verification_status : undefined }];
  });
}
function addUsage(target: ProviderUsage, addition?: ProviderUsage) { target.requests += addition?.requests ?? 0; target.credits = (target.credits ?? 0) + (addition?.credits ?? 0); }
function contactVerificationState(status?: string) { return status?.toLowerCase() === "accept_all" ? "ACCEPT_ALL" : "VALID"; }
function contactScore(contact: ContactCandidate, desiredRoles: string[] = []) {
  const personal = contact.kind === "person" || contact.kind === "personal" ? 20 : 0;
  const verified = contact.verificationStatus?.toLowerCase() === "valid" ? 30 : 0;
  const preferredRole = roleMatchesPreference(contact.role, desiredRoles) ? 45 : 0;
  return contact.confidence * 100 + personal + verified + preferredRole;
}

function queryStringArray(query: unknown, key: string) {
  const value = query && typeof query === "object" && !Array.isArray(query) ? (query as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function withoutLocalProspectingFields<Query>(query: Query): Query {
  if (!query || typeof query !== "object" || Array.isArray(query)) return query;
  const copy = { ...(query as Record<string, unknown>) };
  delete copy.desired_roles;
  delete copy.keywords;
  delete copy.exclude_company_traits;
  delete copy.segment;
  delete copy.okved_labels;
  return copy as Query;
}

function isExpectedMissingSite(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:нет сайта|не удалось найти публичный адрес сайта)/i.test(message);
}

async function saveContact(prisma: PrismaClient, companyId: string, contact: ContactCandidate, verification?: Pick<HunterVerificationResult, "status" | "score">, verificationSource?: string) {
  const { observations, ...persisted } = contact;
  const saved = await prisma.companyProspectContact.upsert({
    where: { companyId_email: { companyId, email: contact.email } },
    create: { companyId, ...persisted, verificationStatus: verification?.status ?? contact.verificationStatus, verificationState: verification ? verificationState(verification.status) : undefined, verificationScore: verification?.score, verificationSource, verifiedAt: verification ? new Date() : undefined },
    update: { kind: contact.kind, name: contact.name, role: contact.role, confidence: { set: contact.confidence }, verificationStatus: verification?.status ?? contact.verificationStatus, verificationState: verification ? verificationState(verification.status) : undefined, verificationScore: verification?.score, verificationSource, verifiedAt: verification ? new Date() : undefined, observedAt: new Date() },
  });
  for (const observation of observations ?? [{ source: contact.source, sourceUrl: contact.sourceUrl }]) {
    const sourceKey = `${observation.source}:${observation.sourceUrl ?? contact.email}`;
    await prisma.companyProspectContactSource.upsert({ where: { contactId_sourceKey: { contactId: saved.id, sourceKey } }, create: { contactId: saved.id, provider: observation.source, sourceKey, sourceUrl: observation.sourceUrl }, update: { sourceUrl: observation.sourceUrl, observedAt: new Date() } });
  }
  return saved;
}

async function persistDiscoveredContacts(prisma: PrismaClient, companyId: string, contacts: Map<string, ContactCandidate>) {
  for (const contact of contacts.values()) await saveContact(prisma, companyId, contact);
}
