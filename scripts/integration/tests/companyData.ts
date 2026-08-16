import { assert, prisma, suiteHeader, test } from "../harness";
import { ensureCompanyDataSource, ingestProviderCompanies, searchCompanies } from "@/lib/company-data";
import { CheckoProvider, DataNewtonProvider, HunterProvider } from "@/lib/company-data";

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

  await test("Checko adapter loads search hits and full company cards", async () => {
    const calls: string[] = [];
    const fakeFetch = async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return Response.json(url.includes("/search")
        ? { data: [{ ИНН: "7707083893" }] }
        : { data: { ИНН: "7707083893", ОГРН: "1027700132195", НаимСокр: "Тест", Контакты: { ВебСайт: "test.ru", Емэйл: ["info@test.ru"] } } });
    };
    const page = await new CheckoProvider("secret", fakeFetch as typeof fetch).search({ by: "okved", query: "62.01", limit: 1 });
    assert.equal(page.items[0].identity?.domain, "test.ru");
    assert.deepEqual(page.items[0].fields?.company_emails, ["info@test.ru"]);
    assert.equal(page.usage?.requests, 2);
    assert.ok(calls.every((url) => url.includes("key=secret")));
  });

  await test("DataNewton and Hunter adapters normalize configurable API responses", async () => {
    const dataNewtonFetch = async () => Response.json({ items: [{
      id: "dn-1", inn: "7707083893", short_name: "Тест", websites: ["test.ru"],
      contacts: { emails: ["sales@test.ru"] }, finance: { revenue: 1000 }, custom_score: 7,
    }] });
    const dn = await new DataNewtonProvider({
      apiKey: "secret", baseUrl: "https://api.example/", searchPath: "/filters", authMode: "bearer",
    }, dataNewtonFetch as typeof fetch).search({ limit: 1, filters: { okved: ["62.01"] } });
    assert.equal(dn.items[0].fields?.revenue, 1000);
    assert.equal(dn.items[0].fields?.["datanewton.custom_score"], 7);

    const hunterFetch = async () => Response.json({ data: { organization: "Тест", pattern: "{first}", emails: [{
      value: "ceo@test.ru", first_name: "Иван", position: "CEO", confidence: 98,
    }] } });
    const hunter = await new HunterProvider("secret", hunterFetch as typeof fetch).search({ domains: ["test.ru"] });
    assert.equal(hunter.usage?.credits, 1);
    const emails = hunter.items[0].fields?.hunter_emails;
    assert.ok(Array.isArray(emails));
    assert.equal((emails?.[0] as { email: string }).email, "ceo@test.ru");
  });
}
