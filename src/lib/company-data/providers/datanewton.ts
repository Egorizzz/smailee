import type { CompanyDataProvider, JsonValue, ProviderCompany, ProviderPage } from "../types";
import { fetchJson, firstArray, isRecord, namespaceFields, stringsAt, textAt, type FetchLike } from "./http";

export type DataNewtonQuery = Record<string, JsonValue> & { limit?: number };
export type DataNewtonAuthMode = "bearer" | "x-api-key" | "query";

export type DataNewtonConfig = {
  apiKey: string;
  baseUrl: string;
  searchPath: string;
  authMode?: DataNewtonAuthMode;
};

/**
 * DataNewton exposes the Filters API under contracts issued with an account.
 * Base URL/path/auth are configurable because these values differ between API products and contracts.
 */
export class DataNewtonProvider implements CompanyDataProvider<DataNewtonQuery> {
  readonly key = "datanewton";
  readonly name = "DataNewton";
  readonly capabilities = { companySearch: true, batchApi: true, contacts: true, arbitraryFilters: true } as const;

  constructor(private readonly config: DataNewtonConfig, private readonly fetcher: FetchLike = fetch) {
    if (!config.apiKey) throw new Error("DATANEWTON_API_KEY is not configured");
    if (!config.baseUrl || !config.searchPath) throw new Error("DATANEWTON_BASE_URL and DATANEWTON_SEARCH_PATH are required");
  }

  async search(query: DataNewtonQuery): Promise<ProviderPage> {
    const url = new URL(this.config.searchPath, withSlash(this.config.baseUrl));
    const headers = new Headers({ "content-type": "application/json" });
    const mode = this.config.authMode ?? "bearer";
    if (mode === "bearer") headers.set("authorization", `Bearer ${this.config.apiKey}`);
    if (mode === "x-api-key") headers.set("x-api-key", this.config.apiKey);
    if (mode === "query") url.searchParams.set("key", this.config.apiKey);
    const body = await fetchJson(this.fetcher, "DataNewton", url, {
      method: "POST", headers, body: JSON.stringify(query),
    });
    const limit = Math.min(Math.max(Number(query.limit ?? 25), 1), 500);
    const items = firstArray(body).slice(0, limit).filter(isRecord).map(mapDataNewtonCompany);
    const nextCursor = textAt(body, "next_cursor", "nextCursor", "meta.next_cursor", "pagination.next");
    return { items, nextCursor, usage: { requests: 1 } };
  }
}

function mapDataNewtonCompany(raw: Record<string, unknown>): ProviderCompany {
  const inn = textAt(raw, "inn", "ИНН", "requisites.inn", "company.inn");
  const ogrn = textAt(raw, "ogrn", "ОГРН", "requisites.ogrn", "company.ogrn");
  const websites = stringsAt(raw, "websites", "website", "contacts.websites", "contacts.sites");
  const emails = stringsAt(raw, "emails", "email", "contacts.emails");
  const phones = stringsAt(raw, "phones", "phone", "contacts.phones");
  return {
    externalId: textAt(raw, "id", "company_id", "ogrn", "ОГРН", "inn", "ИНН") ?? crypto.randomUUID(),
    identity: { inn, ogrn, domain: websites[0] },
    legalName: textAt(raw, "full_name", "name.full", "company.full_name", "НаимПолн"),
    displayName: textAt(raw, "short_name", "name.short", "name", "company.name", "НаимСокр"),
    website: websites[0],
    status: textAt(raw, "status", "status.name", "company.status"),
    fields: {
      ...namespaceFields("datanewton", raw),
      region: textAt(raw, "region", "region.name", "address.region", "company.region") ?? null,
      primary_okved: textAt(raw, "okved", "okved.code", "main_okved.code", "company.okved") ?? null,
      revenue: numberOrNull(raw, "revenue", "finance.revenue", "financials.revenue"),
      employee_count: numberOrNull(raw, "employee_count", "employees", "staff.count"),
      leader_name: textAt(raw, "leader.name", "director.name", "management.name") ?? null,
      company_emails: emails,
      company_phones: phones,
      datanewton_payload: raw as unknown as JsonValue,
    },
    raw: raw as unknown as JsonValue,
  };
}

function numberOrNull(raw: Record<string, unknown>, ...paths: string[]): number | null {
  const value = textAt(raw, ...paths);
  if (!value) return null;
  const number = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}
function withSlash(value: string) { return value.endsWith("/") ? value : `${value}/`; }
