import type { HunterVerificationResult, HunterVerificationStatus } from "./hunter";
import { fetchJson, type FetchLike } from "./http";

export type ReoonVerificationResult = HunterVerificationResult & {
  providerStatus: string;
  safeToSend?: boolean;
  deliverable?: boolean;
  roleAccount?: boolean;
};

export class ReoonProvider {
  readonly key = "reoon";
  readonly name = "Reoon";
  readonly capabilities = { emailVerification: true } as const;

  constructor(private readonly apiKey: string, private readonly fetcher: FetchLike = fetch) {
    if (!apiKey) throw new Error("REOON_API_KEY is not configured");
  }

  async verifyEmail(email: string): Promise<ReoonVerificationResult> {
    const normalized = email.trim().toLowerCase();
    const url = new URL("https://emailverifier.reoon.com/api/v1/verify");
    url.searchParams.set("email", normalized);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("mode", "power");
    const body = await fetchJson(this.fetcher, "Reoon", url);
    const providerStatus = typeof body.status === "string" ? body.status.toLowerCase() : "unknown";
    const status = normalizeReoonStatus(providerStatus, body);
    return {
      email: typeof body.email === "string" ? body.email.toLowerCase() : normalized,
      status,
      providerStatus,
      score: typeof body.overall_score === "number" ? body.overall_score : undefined,
      smtpCheck: typeof body.can_connect_smtp === "boolean" ? body.can_connect_smtp : undefined,
      acceptAll: typeof body.is_catch_all === "boolean" ? body.is_catch_all : providerStatus === "catch_all",
      disposable: typeof body.is_disposable === "boolean" ? body.is_disposable : providerStatus === "disposable",
      webmail: typeof body.is_free_email === "boolean" ? body.is_free_email : undefined,
      safeToSend: typeof body.is_safe_to_send === "boolean" ? body.is_safe_to_send : undefined,
      deliverable: typeof body.is_deliverable === "boolean" ? body.is_deliverable : undefined,
      roleAccount: typeof body.is_role_account === "boolean" ? body.is_role_account : providerStatus === "role_account",
      usage: { requests: 1, credits: providerStatus === "unknown" ? 0 : 1, creditsEstimated: true },
    };
  }
}

function normalizeReoonStatus(status: string, body: Record<string, unknown>): HunterVerificationStatus {
  if (status === "safe" || status === "valid") return "valid";
  if (status === "catch_all" || body.is_catch_all === true) return "accept_all";
  if (status === "disposable" || body.is_disposable === true) return "disposable";
  if (status === "role_account") {
    return body.is_deliverable === true || body.is_safe_to_send === true ? "valid" : "unknown";
  }
  if (status === "invalid" || status === "disabled" || status === "inbox_full" || status === "spamtrap") return "invalid";
  if (status === "pending") return "pending";
  return "unknown";
}
