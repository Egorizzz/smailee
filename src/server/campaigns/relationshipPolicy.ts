import type { OutreachChannel } from "@prisma/client";

export type RelationshipBlockCode =
  | "ENDPOINT_SUPPRESSED"
  | "ENDPOINT_INACTIVE"
  | "CONTACT_IRRELEVANT"
  | "COMPANY_CONVERSATION_ACTIVE"
  | "CONTACT_ALREADY_RESERVED";

export type RelationshipDecision =
  | { allowed: true; code: "ALLOWED" }
  | { allowed: false; code: RelationshipBlockCode };

/**
 * Чистая cross-channel policy допуска касания. Конкретный adapter приводит
 * email status, Telegram peer state и platform suppression к этим входам.
 * Блокировка компании и уже состоявшееся касание общие для всех каналов:
 * ответ по email не должен разрешать параллельный холодный Telegram.
 */
export function evaluateRelationshipDelivery(input: {
  channel: OutreachChannel;
  endpointSuppressed: boolean;
  endpointActive: boolean;
  contactRelevant: boolean;
  companyConversationActive?: boolean;
  contactAlreadyReserved?: boolean;
}): RelationshipDecision {
  if (input.endpointSuppressed) {
    return { allowed: false, code: "ENDPOINT_SUPPRESSED" };
  }
  if (!input.endpointActive) {
    return { allowed: false, code: "ENDPOINT_INACTIVE" };
  }
  if (!input.contactRelevant) {
    return { allowed: false, code: "CONTACT_IRRELEVANT" };
  }
  if (input.companyConversationActive) {
    return { allowed: false, code: "COMPANY_CONVERSATION_ACTIVE" };
  }
  if (input.contactAlreadyReserved) {
    return { allowed: false, code: "CONTACT_ALREADY_RESERVED" };
  }
  return { allowed: true, code: "ALLOWED" };
}
