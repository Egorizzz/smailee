import type { CompanyDataProvider, JsonValue, ProviderCompany, ProviderPage } from "../types";
import { fetchJson, firstArray, isRecord, namespaceFields, stringsAt, textAt, type FetchLike } from "./http";

export type CheckoQuery = {
  by?: "name" | "founder-name" | "leader-name" | "okved" | "reg-date" | "upd-date";
  query?: string;
  obj?: "org" | "ent";
  objects?: Array<"org" | "ent">;
  okveds?: string[];
  region_codes?: string[];
  opf_codes?: string[];
  okved?: string;
  region?: string;
  opf?: string;
  codes?: "all";
  active?: boolean;
  page?: number;
  offset?: number;
  limit?: number;
  hydrateDetails?: boolean;
};

export class CheckoProvider implements CompanyDataProvider<CheckoQuery> {
  readonly key = "checko";
  readonly name = "Checko";
  readonly capabilities = { companySearch: true, companyDetails: true, contacts: true } as const;

  constructor(private readonly apiKey: string, private readonly fetcher: FetchLike = fetch) {
    if (!apiKey) throw new Error("CHECKO_API_KEY is not configured");
  }

  async search(query: CheckoQuery): Promise<ProviderPage> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 40_000);
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const variants = expandQueries(query);
    const hitsByVariant: Record<string, unknown>[][] = [];
    let requests = 0;
    for (const variant of variants) {
      const hits: Record<string, unknown>[] = [];
      // Делим окно между всеми выбранными ОКВЭДами/регионами/формами,
      // иначе первый код заполнял всю небольшую выборку и остальные не участвовали.
      const targetForVariant = Math.ceil((offset + limit) / variants.length);
      for (let page = 1; hits.length < targetForVariant; page++) {
        const url = new URL("https://api.checko.ru/v2/search");
        for (const [key, value] of Object.entries({ ...variant, page, limit: 100 })) if (value !== undefined) url.searchParams.set(key, String(value));
        url.searchParams.set("key", this.apiKey);
        const searchBody = await fetchJson(this.fetcher, "Checko", url);
        requests++;
        const pageHits = firstArray(searchBody, ["data", "Записи", "items", "results", "companies"]);
        for (const hit of pageHits) if (isRecord(hit)) hits.push(hit);
        if (pageHits.length < 100) break;
      }
      hitsByVariant.push(hits);
    }
    const interleaved: Record<string, unknown>[] = [];
    const longest = Math.max(0, ...hitsByVariant.map((hits) => hits.length));
    for (let index = 0; index < longest; index++) {
      for (const hits of hitsByVariant) if (hits[index]) interleaved.push(hits[index]);
    }
    const uniqueHits = [...new Map(interleaved.map((hit) => [textAt(hit, "ИНН", "inn") ?? textAt(hit, "ОГРН", "ОГРНИП", "ogrn", "ogrnip") ?? crypto.randomUUID(), hit])).values()].slice(offset, offset + limit);
    const items: ProviderCompany[] = [];
    for (const hit of uniqueHits) {
      const inn = textAt(hit, "ИНН", "inn");
      const ogrn = textAt(hit, "ОГРН", "ogrn");
      if (!inn && !ogrn) continue;
      if (query.hydrateDetails === false) {
        items.push(mapCheckoCompany(hit));
        continue;
      }
      const entrepreneur = Boolean((inn && inn.length === 12) || (ogrn && ogrn.length === 15));
      const detailUrl = new URL(`https://api.checko.ru/v2/${entrepreneur ? "entrepreneur" : "company"}`);
      detailUrl.searchParams.set("key", this.apiKey);
      detailUrl.searchParams.set(inn ? "inn" : entrepreneur ? "ogrnip" : "ogrn", inn ?? ogrn!);
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
      const isEntrepreneur = id.length === 12 || id.length === 15;
      const url = new URL(`https://api.checko.ru/v2/${isEntrepreneur ? "entrepreneur" : "company"}`);
      url.searchParams.set("key", this.apiKey);
      url.searchParams.set(id.length >= 13 ? (isEntrepreneur ? "ogrnip" : "ogrn") : "inn", id);
      const body = await fetchJson(this.fetcher, "Checko", url);
      if (isRecord(body.data)) items.push(mapCheckoCompany(body.data));
    }
    return items;
  }
}

function expandQueries(query: CheckoQuery) {
  if (query.by && query.query) return [{
    by: query.by, query: query.query, obj: query.obj ?? "org", okved: query.okved,
    region: query.region, opf: query.opf, active: query.active, codes: query.codes,
  }];
  const okveds = query.okveds?.filter(Boolean) ?? [];
  if (!okveds.length) throw new Error("Checko search requires at least one OKVED");
  const objects = query.objects?.length ? query.objects : ["org" as const];
  const regions = query.region_codes?.filter((value) => /^\d{2}$/.test(value)) ?? [];
  const orgOpfs = query.opf_codes?.filter((value) => value !== "50102") ?? [];
  return objects.flatMap((obj) => okveds.flatMap((okved) =>
    (regions.length ? regions : [undefined]).flatMap((region) =>
      (obj === "org" && orgOpfs.length ? orgOpfs : [undefined]).map((opf) => ({
        by: "okved" as const, query: okved, obj, region, opf,
        active: query.active ?? true, codes: query.codes ?? "all" as const,
      })),
    ),
  ));
}

function mapCheckoCompany(raw: Record<string, unknown>): ProviderCompany {
  const inn = textAt(raw, "ИНН", "inn");
  const ogrn = textAt(raw, "ОГРН", "ОГРНИП", "ogrn", "ogrnip");
  const website = textAt(raw, "Контакты.ВебСайт", "contacts.website", "website");
  const emails = stringsAt(raw, "Контакты.Емэйл", "contacts.emails", "emails");
  const phones = stringsAt(raw, "Контакты.Тел", "contacts.phones", "phones");
  const leader = textAt(raw, "Руковод.ФИО", "Руковод.0.ФИО", "Руководитель.ФИО", "leader.name");
  return {
    externalId: ogrn ?? inn ?? crypto.randomUUID(),
    identity: { inn, ogrn, domain: website },
    legalName: textAt(raw, "НаимПолн", "full_name", "name.full"),
    displayName: textAt(raw, "НаимСокр", "ФИО", "short_name", "name.short", "name.full"),
    website,
    status: textAt(raw, "Статус.Наим", "status.name", "status"),
    fields: {
      ...namespaceFields("checko", raw),
      region: textAt(raw, "Регион.Наим", "region.name") ?? null,
      region_code: textAt(raw, "Регион.Код", "РегионКод", "region.code") ?? null,
      primary_okved: textAt(raw, "ОКВЭД.Код", "okved.code") ?? null,
      primary_okved_name: textAt(raw, "ОКВЭД.Наим", "ОКВЭД", "okved.name") ?? null,
      leader_name: leader ?? null,
      company_emails: emails,
      company_phones: phones,
    },
    raw: raw as JsonValue,
  };
}
