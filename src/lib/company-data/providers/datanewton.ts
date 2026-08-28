import type { CompanyDataProvider, JsonValue, ProviderCompany, ProviderPage } from "../types";
import { fetchJson, firstArray, isRecord, namespaceFields, stringsAt, textAt, type FetchLike } from "./http";

export type DataNewtonQuery = Record<string, JsonValue> & { limit?: number };
export type DataNewtonAuthMode = "bearer" | "x-api-key" | "query";

export type DataNewtonConfig = {
  apiKey: string;
  baseUrl: string;
  searchPath?: string;
  counterpartyPath?: string;
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
    if (!config.baseUrl) throw new Error("DATANEWTON_BASE_URL is required");
  }

  async search(query: DataNewtonQuery): Promise<ProviderPage> {
    if (!this.config.searchPath) throw new Error("DATANEWTON_SEARCH_PATH is required for Filters API");
    const url = new URL(this.config.searchPath, withSlash(this.config.baseUrl));
    const headers = new Headers({ "content-type": "application/json" });
    const mode = this.config.authMode ?? "bearer";
    if (mode === "bearer") headers.set("authorization", `Bearer ${this.config.apiKey}`);
    if (mode === "x-api-key") headers.set("x-api-key", this.config.apiKey);
    if (mode === "query") url.searchParams.set("key", this.config.apiKey);
    const { limit: requestedLimit, offset: requestedOffset, ...filters } = query;
    if (this.config.searchPath.includes("batchCardsByFilters")) {
      url.searchParams.set("limit", String(requestedLimit ?? 25));
      url.searchParams.set("offset", String(requestedOffset ?? 0));
    }
    const body = await fetchJson(this.fetcher, "DataNewton", url, {
      method: "POST", headers, body: JSON.stringify(filters),
    });
    const limit = Math.min(Math.max(Number(requestedLimit ?? 25), 1), 500);
    const items = firstArray(body).slice(0, limit).filter(isRecord).map(mapDataNewtonCompany);
    const nextCursor = textAt(body, "next_cursor", "nextCursor", "meta.next_cursor", "pagination.next");
    return { items, nextCursor, usage: { requests: 1 } };
  }

  async getByIds(ids: string[]): Promise<ProviderCompany[]> {
    const items: ProviderCompany[] = [];
    for (const inn of [...new Set(ids.filter(Boolean))]) {
      const url = new URL(this.config.counterpartyPath ?? "/v1/counterparty", withSlash(this.config.baseUrl));
      url.searchParams.set("key", this.config.apiKey);
      url.searchParams.set("inn", inn);
      url.searchParams.set("filters", "CONTACT_BLOCK,OKVED_BLOCK,MANAGER_BLOCK,WORKERS_COUNT_BLOCK");
      const body = await fetchJson(this.fetcher, "DataNewton", url);
      items.push(mapDataNewtonCompany(body));
    }
    return items;
  }
}

function mapDataNewtonCompany(raw: Record<string, unknown>): ProviderCompany {
  const inn = textAt(raw, "inn", "ИНН", "requisites.inn", "company.inn", "main_block.inn");
  const ogrn = textAt(raw, "ogrn", "ОГРН", "requisites.ogrn", "company.ogrn", "main_block.ogrn");
  const websites = stringsAt(raw, "websites", "website", "contacts.websites", "contacts.sites", "company.contacts.websites", "contacts_block.websites");
  const emails = stringsAt(raw, "emails", "email", "contacts.emails", "company.contacts.emails", "contacts_block.emails");
  const phones = stringsAt(raw, "phones", "phone", "contacts.phones", "company.contacts.phones", "contacts_block.phones");
  return {
    externalId: textAt(raw, "id", "company_id", "ogrn", "ОГРН", "inn", "ИНН", "main_block.id", "main_block.ogrn") ?? crypto.randomUUID(),
    identity: { inn, ogrn, domain: websites[0] },
    legalName: textAt(raw, "full_name", "name.full", "company.full_name", "company.company_names.full_name", "company.company_names.full", "main_block.full_name", "НаимПолн"),
    displayName: textAt(raw, "short_name", "name.short", "company.name", "company.company_names.short_name", "company.company_names.short", "main_block.name", "НаимСокр", "name"),
    website: websites[0],
    status: textAt(raw, "status", "status.name", "company.status", "main_block.status.status_rus_short", "main_block.status.status_egr"),
    fields: {
      ...namespaceFields("datanewton", raw),
      region: textAt(raw, "region", "region.name", "address.region", "company.region", "address_block.region") ?? null,
      primary_okved: textAt(raw, "okved", "okved.code", "main_okved.code", "company.okved", "company.okveds.0.code", "main_block.activity_kind") ?? null,
      revenue: numberOrNull(raw, "revenue", "finance.revenue", "financials.revenue"),
      employee_count: numberOrNull(raw, "employee_count", "employees", "staff.count", "company.workers_count.value", "company.workers_count", "workers_count_block.2025", "workers_count_block.2024"),
      leader_name: textAt(raw, "leader.name", "director.name", "management.name", "company.managers.0.name", "company.managers.0.fio", "managers_block.managers.0.name", "managers_block.managers.0.fio") ?? null,
      primary_okved_name: textAt(raw, "okved.name", "main_okved.name", "company.okved_name", "main_block.activity_kind_dsc") ?? null,
      company_emails: emails,
      company_phones: phones,
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
