import type { PrismaClient } from "@prisma/client";
import { ensureCompanyDataSource, ingestProviderCompanies } from "./repository";
import type { CompanyDataProvider, JsonValue, ProviderCompany, ProviderUsage } from "./types";
import type { HunterQuery } from "./providers/hunter";

export type ExperimentRow = {
  provider: string;
  companyId: string;
  inn?: string;
  ogrn?: string;
  name?: string;
  domain?: string;
  companyEmails: string[];
  hunterEmails: string[];
  phones: string[];
  availableFields: number;
};

export type ExperimentResult = {
  provider: string;
  rows: ExperimentRow[];
  usage: { company: ProviderUsage; hunter: ProviderUsage };
  summary: {
    companies: number; withDomain: number; withCompanyEmail: number; withHunterEmail: number;
    uniqueCompanyEmails: number; uniqueHunterEmails: number; averageAvailableFields: number;
  };
};

export async function runProviderExperiment<Query>(input: {
  prisma: PrismaClient;
  companyProvider: CompanyDataProvider<Query>;
  hunterProvider?: CompanyDataProvider<HunterQuery>;
  query: Query;
  hunterLimitPerDomain?: number;
  enrichWithHunter?: boolean;
}): Promise<ExperimentResult> {
  const { prisma, companyProvider, hunterProvider } = input;
  await ensureCompanyDataSource(prisma, { key: companyProvider.key, name: companyProvider.name, capabilities: companyProvider.capabilities, priority: 10 });
  if (hunterProvider) await ensureCompanyDataSource(prisma, { key: hunterProvider.key, name: hunterProvider.name, capabilities: hunterProvider.capabilities, priority: 20 });
  const companyPage = await companyProvider.search(input.query);
  const ingested = await ingestProviderCompanies(prisma, companyProvider.key, companyPage.items);
  const domains = companyPage.items.map((item) => normalizedDomain(item)).filter((item): item is string => Boolean(item));
  if (input.enrichWithHunter !== false && !hunterProvider) throw new Error("Hunter provider is required for enrichment");
  const hunterPage = input.enrichWithHunter === false
    ? { items: [], usage: { requests: 0, credits: 0 } }
    : await hunterProvider!.search({ domains, limitPerDomain: input.hunterLimitPerDomain ?? 10 });
  if (hunterProvider && hunterPage.items.length) await ingestProviderCompanies(prisma, hunterProvider.key, hunterPage.items);
  const hunterByDomain = new Map(hunterPage.items.map((item) => [normalizedDomain(item), extractHunterEmails(item)]));
  const rows = companyPage.items.map((company, index): ExperimentRow => {
    const domain = normalizedDomain(company);
    return {
      provider: companyProvider.key,
      companyId: ingested[index].companyId,
      inn: company.identity?.inn, ogrn: company.identity?.ogrn,
      name: company.displayName ?? company.legalName, domain,
      companyEmails: strings(company.fields?.company_emails),
      hunterEmails: domain ? hunterByDomain.get(domain) ?? [] : [],
      phones: strings(company.fields?.company_phones),
      availableFields: countPresent(company.fields ?? {}),
    };
  });
  return {
    provider: companyProvider.key, rows,
    usage: { company: companyPage.usage ?? { requests: 0 }, hunter: hunterPage.usage ?? { requests: 0 } },
    summary: summarize(rows),
  };
}

function normalizedDomain(company: ProviderCompany): string | undefined {
  const value = company.identity?.domain ?? company.website;
  if (!value) return undefined;
  try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return undefined; }
}
function extractHunterEmails(company: ProviderCompany): string[] {
  const value = company.fields?.hunter_emails;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && typeof item.email === "string" ? [item.email] : []);
}
function strings(value: JsonValue | undefined): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function countPresent(fields: Record<string, JsonValue>) { return Object.values(fields).filter((value) => value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)).length; }
function summarize(rows: ExperimentRow[]) {
  const companyEmails = new Set(rows.flatMap((row) => row.companyEmails));
  const hunterEmails = new Set(rows.flatMap((row) => row.hunterEmails));
  return {
    companies: rows.length,
    withDomain: rows.filter((row) => row.domain).length,
    withCompanyEmail: rows.filter((row) => row.companyEmails.length).length,
    withHunterEmail: rows.filter((row) => row.hunterEmails.length).length,
    uniqueCompanyEmails: companyEmails.size,
    uniqueHunterEmails: hunterEmails.size,
    averageAvailableFields: rows.length ? Number((rows.reduce((sum, row) => sum + row.availableFields, 0) / rows.length).toFixed(1)) : 0,
  };
}
