import type { EmailVerificationState } from "@prisma/client";
import type { HunterVerificationResult, HunterVerificationStatus } from "./providers/hunter";

export type EmailVerificationPolicy = {
  allowAcceptAll: boolean;
  minAcceptAllScore: number;
};

export type EmailVerificationDecision = {
  state: EmailVerificationState;
  action: "accept" | "reject" | "retry" | "manual_review";
  reason: string;
};

export function decideEmailVerification(
  result: Pick<HunterVerificationResult, "status" | "score">,
  policy: EmailVerificationPolicy,
): EmailVerificationDecision {
  const state = verificationState(result.status);
  if (result.status === "valid") return { state, action: "accept", reason: "mailbox_valid" };
  if (result.status === "accept_all") {
    return { state, action: "accept", reason: "accept_all_lower_confidence" };
  }
  if (result.status === "unknown" || result.status === "pending") {
    return { state, action: "retry", reason: `verification_${result.status}` };
  }
  return { state, action: "reject", reason: `verification_${result.status}` };
}

export function verificationState(status: HunterVerificationStatus): EmailVerificationState {
  const map: Record<HunterVerificationStatus, EmailVerificationState> = {
    pending: "PENDING", valid: "VALID", invalid: "INVALID", accept_all: "ACCEPT_ALL",
    webmail: "WEBMAIL", disposable: "DISPOSABLE", unknown: "UNKNOWN", claimed: "CLAIMED",
  };
  return map[status];
}
