import type { CompanyDataProvider, ProviderCompany, ProviderPage } from "../types";
import { fetchJson, isRecord, type FetchLike } from "./http";

export type HunterQuery = { domains: string[]; limitPerDomain?: number; department?: string; type?: "personal" | "generic" };

export class HunterProvider implements CompanyDataProvider<HunterQuery> {
  readonly key = "hunter";
  readonly name = "Hunter";
  readonly capabilities = { domainSearch: true, professionalEmails: true, emailVerification: true } as const;

  constructor(private readonly apiKey: string, private readonly fetcher: FetchLike = fetch) {
    if (!apiKey) throw new Error("HUNTER_API_KEY is not configured");
  }

  async search(query: HunterQuery): Promise<ProviderPage> {
    const items: ProviderCompany[] = [];
    let credits = 0;
    for (const domain of [...new Set(query.domains.filter(Boolean))]) {
      const url = new URL("https://api.hunter.io/v2/domain-search");
      url.searchParams.set("api_key", this.apiKey);
      url.searchParams.set("domain", domain);
      url.searchParams.set("limit", String(Math.min(Math.max(query.limitPerDomain ?? 10, 1), 100)));
      if (query.department) url.searchParams.set("department", query.department);
      if (query.type) url.searchParams.set("type", query.type);
      const body = await fetchJson(this.fetcher, "Hunter", url);
      const data = isRecord(body.data) ? body.data : {};
      const emails: Record<string, unknown>[] = [];
      if (Array.isArray(data.emails)) {
        for (const item of data.emails) if (isRecord(item)) emails.push(item);
      }
      if (emails.length) credits += Math.ceil(emails.length / 10);
      items.push({
        externalId: domain,
        identity: { domain },
        displayName: typeof data.organization === "string" ? data.organization : domain,
        website: `https://${domain}`,
        fields: {
          hunter_pattern: typeof data.pattern === "string" ? data.pattern : null,
          hunter_emails: emails.map((email) => ({
            email: typeof email.value === "string" ? email.value : null,
            first_name: typeof email.first_name === "string" ? email.first_name : null,
            last_name: typeof email.last_name === "string" ? email.last_name : null,
            position: typeof email.position === "string" ? email.position : null,
            department: typeof email.department === "string" ? email.department : null,
            type: typeof email.type === "string" ? email.type : null,
            confidence: typeof email.confidence === "number" ? email.confidence : null,
          })),
        },
        raw: body,
      });
    }
    return { items, usage: { requests: items.length, credits, creditsEstimated: true } };
  }
}
