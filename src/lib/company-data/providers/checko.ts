import type { CompanyDataProvider, JsonValue, ProviderCompany, ProviderPage } from "../types";
import { fetchJson, firstArray, isRecord, namespaceFields, stringsAt, textAt, type FetchLike } from "./http";

export type CheckoQuery = {
  by: "name" | "founder-name" | "leader-name" | "okved" | "reg-date" | "upd-date";
  query: string;
  obj?: "org";
  okved?: string;
  opf?: string;
  active?: boolean;
  page?: number;
  limit?: number;
};

export class CheckoProvider implements CompanyDataProvider<CheckoQuery> {
  readonly key = "checko";
  readonly name = "Checko";
  readonly capabilities = { companySearch: true, companyDetails: true, contacts: true } as const;

  constructor(private readonly apiKey: string, private readonly fetcher: FetchLike = fetch) {
    if (!apiKey) throw new Error("CHECKO_API_KEY is not configured");
  }

  async search(query: CheckoQuery): Promise<ProviderPage> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const url = new URL("https://api.checko.ru/v2/search");
    for (const [key, value] of Object.entries({ ...query, limit })) if (value !== undefined) url.searchParams.set(key, String(value));
    url.searchParams.set("key", this.apiKey);
    const searchBody = await fetchJson(this.fetcher, "Checko", url);
    const hits = firstArray(searchBody).slice(0, limit);
    const items: ProviderCompany[] = [];
    let requests = 1;
    for (const hit of hits) {
      if (!isRecord(hit)) continue;
      const inn = textAt(hit, "ИНН", "inn");
      const ogrn = textAt(hit, "ОГРН", "ogrn");
      if (!inn && !ogrn) continue;
      const detailUrl = new URL("https://api.checko.ru/v2/company");
      detailUrl.searchParams.set("key", this.apiKey);
      detailUrl.searchParams.set(inn ? "inn" : "ogrn", inn ?? ogrn!);
      const detailBody = await fetchJson(this.fetcher, "Checko", detailUrl);
      requests++;
      const detail = isRecord(detailBody.data) ? detailBody.data : hit;
      items.push(mapCheckoCompany(detail));
    }
    return { items, usage: { requests } };
  }

  async getByIds(ids: string[]): Promise<ProviderCompany[]> {
    const items: ProviderCompany[] = [];
    for (const id of ids) {
      const url = new URL("https://api.checko.ru/v2/company");
      url.searchParams.set("key", this.apiKey);
      url.searchParams.set(id.length >= 13 ? "ogrn" : "inn", id);
      const body = await fetchJson(this.fetcher, "Checko", url);
      if (isRecord(body.data)) items.push(mapCheckoCompany(body.data));
    }
    return items;
  }
}

function mapCheckoCompany(raw: Record<string, unknown>): ProviderCompany {
  const inn = textAt(raw, "ИНН", "inn");
  const ogrn = textAt(raw, "ОГРН", "ogrn");
  const website = textAt(raw, "Контакты.ВебСайт", "contacts.website", "website");
  const emails = stringsAt(raw, "Контакты.Емэйл", "contacts.emails", "emails");
  const phones = stringsAt(raw, "Контакты.Тел", "contacts.phones", "phones");
  const leader = textAt(raw, "Руковод.ФИО", "Руководитель.ФИО", "leader.name");
  return {
    externalId: ogrn ?? inn ?? crypto.randomUUID(),
    identity: { inn, ogrn, domain: website },
    legalName: textAt(raw, "НаимПолн", "full_name", "name.full"),
    displayName: textAt(raw, "НаимСокр", "short_name", "name.short"),
    website,
    status: textAt(raw, "Статус.Наим", "status.name", "status"),
    fields: {
      ...namespaceFields("checko", raw),
      region: textAt(raw, "Регион.Наим", "region.name") ?? null,
      region_code: textAt(raw, "Регион.Код", "region.code") ?? null,
      primary_okved: textAt(raw, "ОКВЭД.Код", "okved.code") ?? null,
      primary_okved_name: textAt(raw, "ОКВЭД.Наим", "okved.name") ?? null,
      leader_name: leader ?? null,
      company_emails: emails,
      company_phones: phones,
      checko_payload: raw as JsonValue,
    },
    raw: raw as JsonValue,
  };
}
