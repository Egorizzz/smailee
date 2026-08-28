import type { CompanyDataProvider, ProviderCompany, ProviderPage } from "../types";
import { fetchJson, isRecord, ProviderHttpError, type FetchLike } from "./http";

export type HunterQuery = {
  domains: string[];
  limitPerDomain?: number;
  department?: string;
  seniority?: string;
  decisionMaker?: boolean;
  requiredField?: string;
  type?: "personal" | "generic";
};
export type HunterPersonQuery = { domain: string; firstName: string; lastName: string };
export type HunterPersonResult = {
  email?: string;
  score?: number;
  position?: string;
  verificationStatus?: string;
  sources: number;
  usage: { requests: number; credits: number; creditsEstimated: true };
};
export type HunterVerificationStatus = "pending" | "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | "unknown" | "claimed";
export type HunterVerificationResult = {
  email: string;
  status: HunterVerificationStatus;
  score?: number;
  smtpCheck?: boolean;
  acceptAll?: boolean;
  disposable?: boolean;
  webmail?: boolean;
  usage: { requests: 1; credits: number; creditsEstimated: true };
};

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
      if (query.seniority) url.searchParams.set("seniority", query.seniority);
      if (query.decisionMaker !== undefined) url.searchParams.set("decision_maker", String(query.decisionMaker));
      if (query.requiredField) url.searchParams.set("required_field", query.requiredField);
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
            verification_status: hunterVerificationStatus(email),
            verification_date: typeof email.verification_date === "string" ? email.verification_date : null,
          })),
        },
        raw: body,
      });
    }
    return { items, usage: { requests: items.length, credits, creditsEstimated: true } };
  }

  async findPerson(query: HunterPersonQuery): Promise<HunterPersonResult> {
    const url = new URL("https://api.hunter.io/v2/email-finder");
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("domain", query.domain);
    url.searchParams.set("first_name", query.firstName);
    url.searchParams.set("last_name", query.lastName);
    const body = await fetchJson(this.fetcher, "Hunter", url);
    const data = isRecord(body.data) ? body.data : {};
    const verification = isRecord(data.verification) ? data.verification : {};
    const email = typeof data.email === "string" && data.email.includes("@") ? data.email.toLowerCase() : undefined;
    return {
      email,
      score: typeof data.score === "number" ? data.score : undefined,
      position: typeof data.position === "string" ? data.position : undefined,
      verificationStatus: typeof verification.status === "string" ? verification.status : undefined,
      sources: Array.isArray(data.sources) ? data.sources.length : 0,
      usage: { requests: 1, credits: email ? 1 : 0, creditsEstimated: true },
    };
  }

  async verifyEmail(email: string): Promise<HunterVerificationResult> {
    const normalized = email.trim().toLowerCase();
    const url = new URL("https://api.hunter.io/v2/email-verifier");
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("email", normalized);
    try {
      const body = await fetchJson(this.fetcher, "Hunter", url);
      const data = isRecord(body.data) ? body.data : {};
      const status = normalizeVerificationStatus(data.status);
      return {
        email: typeof data.email === "string" ? data.email.toLowerCase() : normalized,
        status,
        score: typeof data.score === "number" ? data.score : undefined,
        smtpCheck: typeof data.smtp_check === "boolean" ? data.smtp_check : undefined,
        acceptAll: typeof data.accept_all === "boolean" ? data.accept_all : undefined,
        disposable: typeof data.disposable === "boolean" ? data.disposable : undefined,
        webmail: typeof data.webmail === "boolean" ? data.webmail : undefined,
        usage: { requests: 1, credits: verificationCredits(status), creditsEstimated: true },
      };
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 451) {
        return { email: normalized, status: "claimed", usage: { requests: 1, credits: 0, creditsEstimated: true } };
      }
      throw error;
    }
  }
}

function hunterVerificationStatus(email: Record<string, unknown>) {
  const verification = isRecord(email.verification) ? email.verification : {};
  const raw = verification.status ?? email.verification_status;
  return typeof raw === "string" ? normalizeVerificationStatus(raw) : null;
}

function normalizeVerificationStatus(value: unknown): HunterVerificationStatus {
  const normalized = typeof value === "string" ? value.toLowerCase().replace(/[-\s]/g, "_") : "unknown";
  if (normalized === "valid" || normalized === "invalid" || normalized === "accept_all" || normalized === "webmail" || normalized === "disposable" || normalized === "pending") return normalized;
  return "unknown";
}

function verificationCredits(status: HunterVerificationStatus) {
  return status === "unknown" || status === "disposable" || status === "claimed" || status === "pending" ? 0 : 0.5;
}
