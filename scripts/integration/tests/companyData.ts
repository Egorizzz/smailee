import { assert, prisma, suiteHeader, test } from "../harness";
import { consolidateDuplicateCompanies, ensureCompanyDataSource, ingestProviderCompanies, searchCompanies } from "@/lib/company-data";
import { cachedExternalOperation, candidateEmailsForPerson, CheckoProvider, DataNewtonProvider, HunterProvider, ReoonProvider } from "@/lib/company-data";
import { analyzeCompanySite, companySiteIntelligenceSchema } from "@/lib/company-data/siteIntelligence";
import type { WebsiteCrawler } from "@/lib/services/websiteCrawler";
import { runProspectingPipeline } from "@/lib/company-data/prospectingPipeline";
import { createProspectingRun, executeProspectingRun, queueProspectingRun } from "@/lib/company-data/prospectingRuns";
import { decideEmailVerification } from "@/lib/company-data/emailVerification";

export default async function companyDataSuite() {
  suiteHeader("Company data providers");

  await test("ingests arbitrary typed fields and deduplicates a company between providers", async () => {
    await ensureCompanyDataSource(prisma, { key: "checko", name: "Checko", priority: 10 });
    await ensureCompanyDataSource(prisma, { key: "compass", name: "Kontur Compass", priority: 20 });
    const base = {
      identity: { inn: "7707083893" }, legalName: "ПАО СБЕРБАНК", raw: { source: "test" },
    } as const;
    const [first] = await ingestProviderCompanies(prisma, "checko", [{
      ...base, externalId: "checko-1", fields: { employee_count: 1200, tags: ["bank", "enterprise"] },
    }]);
    const [second] = await ingestProviderCompanies(prisma, "compass", [{
      ...base, externalId: "compass-1", fields: { revenue: 42_000_000, has_website: true }, raw: { source: "other" },
    }]);
    assert.equal(first.companyId, second.companyId);
    assert.equal(await prisma.company.count(), 1);
    assert.equal(await prisma.companySourceRecord.count(), 2);
    assert.equal(await prisma.companyFieldValue.count(), 4);

    const found = await searchCompanies(prisma, {
      filter: { and: [
        { field: "employee_count", operator: "gte", value: 1000 },
        { field: "has_website", operator: "eq", value: true },
      ] },
    });
    assert.equal(found.length, 1);
  });

  await test("same provider payload is idempotent", async () => {
    await ensureCompanyDataSource(prisma, { key: "fixture", name: "Fixture" });
    const item = { externalId: "1", identity: { ogrn: "1027700132195" }, fields: { city: "Москва" }, raw: { id: 1 } };
    const [created] = await ingestProviderCompanies(prisma, "fixture", [item]);
    const [repeated] = await ingestProviderCompanies(prisma, "fixture", [item]);
    assert.equal(created.unchanged, false);
    assert.equal(repeated.unchanged, true);
    assert.equal(await prisma.company.count(), 1);
  });

  await test("ИНН объединяет старую доменную оболочку с канонической компанией", async () => {
    const canonical = await prisma.company.create({ data: {
      countryCode: "RU", inn: "7707083893", domain: "identity.test", displayName: "Каноническая компания",
    } });
    const shell = await prisma.company.create({ data: {
      domain: "identity.test", displayName: "identity.test", data: { origin: "user_upload" },
    } });
    await ensureCompanyDataSource(prisma, { key: "identity-source", name: "Identity source" });
    const source = await prisma.companyDataSource.findUniqueOrThrow({ where: { key: "identity-source" } });
    await prisma.companySourceRecord.create({ data: {
      sourceId: source.id, companyId: shell.id, externalId: "domain-only",
      rawData: {}, normalizedData: {}, checksum: "identity-test",
    } });

    assert.equal(await consolidateDuplicateCompanies(prisma), 1);
    assert.equal(await prisma.company.count(), 1);
    assert.equal((await prisma.companySourceRecord.findUniqueOrThrow({ where: { sourceId_externalId: { sourceId: source.id, externalId: "domain-only" } } })).companyId, canonical.id);
  });

  await test("provider field safely promotes to JSON when its response shape changes", async () => {
    await ensureCompanyDataSource(prisma, { key: "shape-shifter", name: "Shape shifter" });
    await ingestProviderCompanies(prisma, "shape-shifter", [{
      externalId: "shape-1", identity: { inn: "7700000001" },
      fields: { flexible: ["first", "second"] }, raw: { version: 1 },
    }]);
    await ingestProviderCompanies(prisma, "shape-shifter", [{
      externalId: "shape-1", identity: { inn: "7700000001" },
      fields: { flexible: [{ value: "first", source: "registry" }] }, raw: { version: 2 },
    }]);
    const field = await prisma.companyFieldDefinition.findUniqueOrThrow({ where: { key: "flexible" } });
    const value = await prisma.companyFieldValue.findFirstOrThrow({ where: { fieldId: field.id } });
    assert.equal(field.type, "JSON");
    assert.deepEqual(value.jsonValue, [{ value: "first", source: "registry" }]);
    assert.deepEqual(value.stringList, []);
  });

  await test("short company-site analysis caches evidence and does not rescrape before expiry", async () => {
    const company = await prisma.company.create({ data: { displayName: "Тест", website: "https://example.test" } });
    const scraped: string[] = [];
    const crawler: WebsiteCrawler = {
      async scrape(url) {
        scraped.push(url);
        return url.endsWith("/")
          ? { markdown: "# Тест\nПроизводим промышленные датчики для заводов, металлургических предприятий и распределённых производственных площадок.", links: ["/about", "/news/new-line", "/privacy"] }
          : { markdown: `# Страница компании\nПодтверждённый факт о запуске новой производственной линии и расширении выпуска оборудования. Источник: ${url}`, links: [] };
      },
      async map() { return []; },
      async start() { return { jobId: "unused" }; },
      async status() { return { status: "completed", total: 0, completed: 0, documents: [] }; },
      async cancel() {},
    };
    const analyzer = async ({ url }: { url: string; title?: string | null; markdown: string }) => ({
      relevant: true,
      summary: "Производитель промышленных датчиков.",
      facts: [{ category: "proof" as const, value: "Запустила новую производственную линию", evidence: "новая производственная линия", confidence: 0.9, sensitive: false }],
    });
    const dependencies = { crawler, analyzer, validateUrl: async () => "https://example.test/" };
    const first = await analyzeCompanySite(prisma, company.id, {}, dependencies);
    assert.equal(first.status, "READY");
    assert.equal(first.creditsUsed, 3);
    assert.equal(companySiteIntelligenceSchema.parse(first.intelligence).personalizationHooks.length, 1);
    await analyzeCompanySite(prisma, company.id, {}, dependencies);
    assert.equal(scraped.length, 3);
  });

  await test("shared prospecting pipeline stops after target and stores contact provenance", async () => {
    const selector = {
      key: "pipeline-selector", name: "Selector", capabilities: {},
      async search() { return { items: [
        { externalId: "a", identity: { inn: "1000000001", domain: "a.test" }, displayName: "A", website: "https://a.test", fields: { company_emails: ["hello@a.test"] }, raw: {} },
        { externalId: "b", identity: { inn: "1000000002", domain: "b.test" }, displayName: "B", website: "https://b.test", fields: { company_emails: [] }, raw: {} },
        { externalId: "c", identity: { inn: "1000000003", domain: "c.test" }, displayName: "C", website: "https://c.test", fields: { company_emails: [] }, raw: {} },
      ], usage: { requests: 1 } }; },
    };
    const verifier = {
      key: "pipeline-verifier", name: "Verifier", capabilities: {}, async search() { return { items: [] }; },
      async getByIds(ids: string[]) { return [{ externalId: ids[0], identity: { inn: ids[0] }, status: "ACTIVE", fields: {}, raw: {} }]; },
    };
    const hunter = {
      key: "pipeline-hunter", name: "Hunter", capabilities: {},
      async search(query: { domains: string[] }) { return { items: [{ externalId: query.domains[0], identity: { domain: query.domains[0] }, fields: { hunter_emails: [{ email: `person@${query.domains[0]}`, type: "personal", confidence: 90 }] }, raw: {} }], usage: { requests: 1, credits: 1 } }; },
      async findPerson() { return { sources: 0, usage: { requests: 1, credits: 0, creditsEstimated: true as const } }; },
      async verifyEmail(email: string) { return { email, status: "valid" as const, score: 96, usage: { requests: 1 as const, credits: 0.5, creditsEstimated: true as const } }; },
    };
    const siteAnalyzer = async (_db: typeof prisma, companyId: string) => {
      const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      const withEmail = company.domain === "a.test";
      return {
        creditsUsed: 1, pages: [{ characters: 100 }],
        intelligence: { schemaVersion: 1, summary: "", facts: [], personalizationHooks: [], publicContacts: withEmail ? [{ kind: "email", value: "hello@a.test", sourceUrl: "https://a.test/", generic: true }] : [] },
      } as never;
    };
    const result = await runProspectingPipeline({ prisma, selector, verifier, hunter, query: {}, target: 2, maxCandidates: 3, siteAnalyzer });
    assert.equal(result.complete, true);
    assert.equal(result.processed, 1);
    assert.equal(result.accepted, 2);
    assert.equal(await prisma.companyProspectContact.count(), 2);
    assert.equal(await prisma.companyProspectContactSource.count(), 3);
    assert.equal(await prisma.companyProspectContact.count({ where: { verificationState: "VALID" } }), 2);
    assert.deepEqual((await prisma.companyProspectContact.findMany({ orderBy: { email: "asc" }, select: { email: true, source: true } })), [
      { email: "hello@a.test", source: "pipeline-selector" }, { email: "person@a.test", source: "hunter_domain" },
    ]);
  });

  await test("deep search keeps rejected contacts and reuses them when the company matches later", async () => {
    let includeRegistryEmail = true;
    let sitePasses = false;
    let hunterCalls = 0;
    const selector = {
      key: "deep-cache-selector", name: "Deep cache selector", capabilities: {},
      async search() { return { items: [{
        externalId: "deep-cache-company", identity: { inn: "1000000088", domain: "deep-cache.test" },
        displayName: "Deep cache", website: "https://deep-cache.test",
        fields: { company_emails: includeRegistryEmail ? ["saved@deep-cache.test"] : [] }, raw: {},
      }], usage: { requests: 1 } }; },
    };
    const verifier = {
      key: "deep-cache-verifier", name: "Deep cache verifier", capabilities: {}, async search() { return { items: [] }; },
      async getByIds(ids: string[]) { return [{ externalId: ids[0], identity: { inn: ids[0], domain: "deep-cache.test" }, status: "ACTIVE", fields: {}, raw: {} }]; },
    };
    const hunter = {
      key: "deep-cache-hunter", name: "Deep cache hunter", capabilities: {},
      async search() { hunterCalls++; return { items: [], usage: { requests: 1, credits: 0 } }; },
      async findPerson() { return { sources: 0, usage: { requests: 1, credits: 0, creditsEstimated: true as const } }; },
      async verifyEmail(email: string) { return { email, status: "valid" as const, score: 95, usage: { requests: 1 as const, credits: 0.5, creditsEstimated: true as const } }; },
    };
    const siteAnalyzer = async () => ({
      creditsUsed: 1, pages: [{ characters: 100 }],
      intelligence: {
        schemaVersion: 1, summary: sitePasses ? "Компания участвует в тендерах" : "Производитель оборудования",
        facts: [], personalizationHooks: [], publicContacts: [],
      },
    }) as never;

    const rejected = await runProspectingPipeline({ prisma, selector, verifier, hunter, query: { keywords: ["работает с тендерами"] }, target: 1, maxCandidates: 1, siteAnalyzer });
    assert.equal(rejected.accepted, 0);
    assert.equal(hunterCalls, 0, "дорогой поиск контактов не нужен до прохождения глубокого фильтра");
    assert.equal(await prisma.companyProspectContact.count({ where: { email: "saved@deep-cache.test" } }), 1);

    includeRegistryEmail = false;
    sitePasses = true;
    const reused = await runProspectingPipeline({ prisma, selector, verifier, hunter, query: { keywords: ["работает с тендерами"] }, target: 1, maxCandidates: 1, siteAnalyzer });
    assert.equal(reused.accepted, 1);
    assert.equal(reused.rows[0]?.contacts[0]?.email, "saved@deep-cache.test");
  });

  await test("email verification accepts catch-all with lower confidence and retries unknown results", async () => {
    assert.equal(decideEmailVerification({ status: "valid", score: 90 }, { allowAcceptAll: false, minAcceptAllScore: 85 }).action, "accept");
    assert.equal(decideEmailVerification({ status: "accept_all", score: 99 }, { allowAcceptAll: false, minAcceptAllScore: 85 }).action, "accept");
    assert.equal(decideEmailVerification({ status: "accept_all", score: 90 }, { allowAcceptAll: true, minAcceptAllScore: 85 }).action, "accept");
    assert.equal(decideEmailVerification({ status: "unknown" }, { allowAcceptAll: false, minAcceptAllScore: 85 }).action, "retry");
    assert.equal(decideEmailVerification({ status: "invalid" }, { allowAcceptAll: false, minAcceptAllScore: 85 }).action, "reject");
  });

  await test("prospecting runs are tenant-scoped drafts with explicit budgets and confirmation", async () => {
    const owner = await prisma.user.create({ data: { email: "prospecting-owner@test.local", passwordHash: "x", plan: "START" } });
    const organization = await prisma.organization.create({ data: { name: "Prospecting tenant", ownerId: owner.id } });
    await prisma.user.update({ where: { id: owner.id }, data: { organizationId: organization.id } });
    const run = await createProspectingRun(prisma, {
      organizationId: organization.id, createdById: owner.id, query: { filters: { okved: ["62.01"] } },
      targetCompanies: 10, maxCandidates: 20, budgets: { maxHunterCredits: 8 },
    });
    assert.equal(run.status, "DRAFT");
    assert.equal(run.allowAcceptAll, true);
    assert.equal((run.budgets as { maxHunterCredits: number }).maxHunterCredits, 8);
    await queueProspectingRun(prisma, organization.id, run.id);
    assert.equal((await prisma.prospectingRun.findUniqueOrThrow({ where: { id: run.id } })).status, "QUEUED");
    await assert.rejects(() => queueProspectingRun(prisma, "other-tenant", run.id));
  });

  await test("persisted prospecting run stores accepted candidate and selected verified contact", async () => {
    const owner = await prisma.user.create({ data: { email: "pipeline-owner@test.local", passwordHash: "x", plan: "START" } });
    const organization = await prisma.organization.create({ data: { name: "Pipeline tenant", ownerId: owner.id } });
    await prisma.user.update({ where: { id: owner.id }, data: { organizationId: organization.id } });
    const run = await createProspectingRun(prisma, {
      organizationId: organization.id, createdById: owner.id, query: {}, targetCompanies: 1, maxCandidates: 1,
    });
    const selector = {
      key: "run-selector", name: "Run selector", capabilities: {},
      async search() { return { items: [{ externalId: "run-company", identity: { inn: "1000000099", domain: "run.test" }, displayName: "Run", website: "https://run.test", fields: {}, raw: {} }], usage: { requests: 1 } }; },
    } as unknown as ReturnType<typeof import("@/lib/company-data").dataNewtonFromEnv>;
    const verifier = {
      key: "run-verifier", name: "Run verifier", capabilities: {}, async search() { return { items: [] }; },
      async getByIds(ids: string[]) { return [{ externalId: ids[0], identity: { inn: ids[0] }, status: "ACTIVE", fields: {}, raw: {} }]; },
    } as unknown as ReturnType<typeof import("@/lib/company-data").checkoFromEnv>;
    const hunter = {
      key: "run-hunter", name: "Run hunter", capabilities: {},
      async search() { return { items: [], usage: { requests: 1, credits: 0 } }; },
      async findPerson() { return { sources: 0, usage: { requests: 1, credits: 0, creditsEstimated: true as const } }; },
      async verifyEmail(email: string) { return { email, status: "valid" as const, score: 95, usage: { requests: 1 as const, credits: 0.5, creditsEstimated: true as const } }; },
    } as unknown as ReturnType<typeof import("@/lib/company-data").hunterFromEnv>;
    const siteAnalyzer = async () => ({
      creditsUsed: 1, pages: [{ characters: 100 }],
      intelligence: { schemaVersion: 1, summary: "", facts: [], personalizationHooks: [], publicContacts: [{ kind: "email", value: "hello@run.test", sourceUrl: "https://run.test/", generic: true }] },
    }) as never;
    const result = await executeProspectingRun(prisma, run, { selector, verifier, hunter, siteAnalyzer });
    assert.equal(result.complete, true);
    const saved = await prisma.prospectingRun.findUniqueOrThrow({ where: { id: run.id }, include: { candidates: { include: { selectedContact: true } } } });
    assert.equal(saved.status, "COMPLETED");
    assert.equal(saved.candidates[0].status, "ACCEPTED");
    assert.equal(saved.candidates[0].selectedContact?.email, "hello@run.test");
    assert.equal(saved.candidates[0].selectedContact?.verificationState, "VALID");
  });

  await test("Checko adapter loads search hits and full company cards", async () => {
    const calls: string[] = [];
    const fakeFetch = async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return Response.json(url.includes("/search")
        ? { data: { Записи: [{ ИНН: "7707083893" }] } }
        : { data: { ИНН: "7707083893", ОГРН: "1027700132195", НаимСокр: "Тест", Контакты: { ВебСайт: "test.ru", Емэйл: ["info@test.ru"] } } });
    };
    const page = await new CheckoProvider("secret", fakeFetch as typeof fetch).search({ by: "okved", query: "62.01", limit: 1 });
    assert.equal(page.items[0].identity?.inn, "7707083893");
    assert.equal(page.items[0].identity?.domain, "test.ru");
    assert.deepEqual(page.items[0].fields?.company_emails, ["info@test.ru"]);
    assert.equal(page.usage?.requests, 2);
    assert.ok(calls.every((url) => url.includes("key=secret")));
  });

  await test("Checko adapter applies registry filters and mixes several OKVED groups", async () => {
    const calls: string[] = [];
    const fakeFetch = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      const code = url.searchParams.get("query") ?? "unknown";
      return Response.json({ data: { Записи: [
        { ИНН: code === "69.10" ? "7700000001" : "7800000001", НаимСокр: `ОКВЭД ${code}` },
      ] } });
    };
    const page = await new CheckoProvider("secret", fakeFetch as typeof fetch).search({
      okveds: ["69.10", "86.23"], region_codes: ["77"], objects: ["org"],
      active: true, codes: "all", hydrateDetails: false, limit: 2,
    });
    assert.deepEqual(page.items.map((item) => item.displayName), ["ОКВЭД 69.10", "ОКВЭД 86.23"]);
    assert.equal(page.usage?.requests, 2);
    assert.ok(calls.every((url) => url.includes("by=okved") && url.includes("region=77") && url.includes("active=true") && url.includes("codes=all")));
  });

  await test("DataNewton and Hunter adapters normalize configurable API responses", async () => {
    const dataNewtonFetch = async () => Response.json({ items: [{
      id: "dn-1", inn: "7707083893", short_name: "Тест", websites: ["test.ru"],
      contacts: { emails: ["sales@test.ru"] }, finance: { revenue: 1000 }, custom_score: 7,
    }] });
    const dn = await new DataNewtonProvider({
      apiKey: "secret", baseUrl: "https://api.example/", searchPath: "/filters", authMode: "bearer",
    }, dataNewtonFetch as typeof fetch).search({ limit: 1, filters: { okved: ["62.01"] } });
    assert.equal(dn.items[0].identity?.inn, "7707083893");
    assert.equal(dn.items[0].fields?.revenue, 1000);
    assert.equal(dn.items[0].fields?.["datanewton.custom_score"], 7);

    const hunterUrls: string[] = [];
    const hunterFetch = async (input: string | URL | Request) => { hunterUrls.push(String(input)); return Response.json({ data: { organization: "Тест", pattern: "{first}", emails: [{
      value: "ceo@test.ru", first_name: "Иван", position: "CEO", confidence: 98,
    }] } }); };
    const hunter = await new HunterProvider("secret", hunterFetch as typeof fetch).search({ domains: ["test.ru"], department: "executive,sales", seniority: "executive,senior", decisionMaker: true, requiredField: "full_name,position" });
    assert.equal(hunter.usage?.credits, 1);
    assert.ok(hunterUrls[0].includes("department=executive%2Csales"));
    assert.ok(hunterUrls[0].includes("decision_maker=true"));
    const emails = hunter.items[0].fields?.hunter_emails;
    assert.ok(Array.isArray(emails));
    assert.equal((emails?.[0] as { email: string }).email, "ceo@test.ru");
  });

  await test("Hunter verifier normalizes delivery state and does not charge unknown", async () => {
    const valid = new HunterProvider("secret", (async () => Response.json({ data: { email: "ceo@test.ru", status: "valid", score: 97, smtp_check: true } })) as typeof fetch);
    const validResult = await valid.verifyEmail("CEO@test.ru");
    assert.equal(validResult.status, "valid");
    assert.equal(validResult.usage.credits, 0.5);
    const unknown = new HunterProvider("secret", (async () => Response.json({ data: { email: "x@test.ru", status: "unknown" } })) as typeof fetch);
    assert.equal((await unknown.verifyEmail("x@test.ru")).usage.credits, 0);
    const claimed = new HunterProvider("secret", (async () => Response.json({ errors: [{ id: "claimed_email" }] }, { status: 451 })) as typeof fetch);
    assert.equal((await claimed.verifyEmail("private@test.ru")).status, "claimed");
  });

  await test("Reoon verifier uses power mode and normalizes provider-specific states", async () => {
    const calls: string[] = [];
    const reoon = new ReoonProvider("secret", (async (input) => {
      calls.push(String(input));
      return Response.json({
        email: "CEO@test.ru", status: "role_account", overall_score: 91,
        is_deliverable: true, is_safe_to_send: true, is_role_account: true,
      });
    }) as typeof fetch);
    const result = await reoon.verifyEmail("CEO@test.ru");
    assert.equal(result.status, "valid");
    assert.equal(result.roleAccount, true);
    assert.equal(result.usage.credits, 1);
    assert.ok(calls[0].includes("mode=power"));
    assert.ok(calls[0].includes("key=secret"));

    const catchAll = new ReoonProvider("secret", (async () => Response.json({ status: "catch_all", is_catch_all: true })) as typeof fetch);
    assert.equal((await catchAll.verifyEmail("x@test.ru")).status, "accept_all");
    const unknown = new ReoonProvider("secret", (async () => Response.json({ status: "unknown" })) as typeof fetch);
    assert.equal((await unknown.verifyEmail("x@test.ru")).usage.credits, 0);
  });

  await test("email patterns generate a leader address without a Finder request", async () => {
    const emails = candidateEmailsForPerson({
      person: { firstName: "Павел", lastName: "Смирнов" }, domain: "company.ru", providerPattern: "{first}.{last}",
    });
    assert.deepEqual(emails, ["pavel.smirnov@company.ru"]);
  });

  await test("external provider operation is reused for 180 days", async () => {
    let calls = 0;
    const execute = async () => { calls++; return { value: "saved", usage: { requests: 1, credits: 1 } }; };
    const first = await cachedExternalOperation({ prisma, provider: "cache-test", operation: "lookup", params: { domain: "test.ru" }, execute, usage: (value) => value.usage });
    const second = await cachedExternalOperation({ prisma, provider: "cache-test", operation: "lookup", params: { domain: "test.ru" }, execute, usage: (value) => value.usage });
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(second.requests, 0);
    assert.equal(calls, 1);
  });
}
