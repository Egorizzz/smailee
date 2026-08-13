import type { CampaignStatus } from "@prisma/client";

export type CampaignQueueReason =
  | "ACCESS_EXPIRED"
  | "PLAN_QUOTA_EXHAUSTED"
  | "NO_AVAILABLE_MAILBOXES"
  | "MAILBOX_DAILY_LIMITS_EXHAUSTED"
  | "OUTSIDE_SEND_WINDOW"
  | "PROCESSING";

export function resolveCampaignQueueReason(input: {
  status: CampaignStatus;
  pendingMessages: number;
  planActive: boolean;
  planQuotaRemaining: number;
  availableMailboxes: number;
  mailboxesWithDailyCapacity: number;
  withinSendWindow: boolean;
}): CampaignQueueReason | null {
  if (input.status !== "QUEUED" || input.pendingMessages <= 0) {
    return null;
  }
  if (!input.planActive) return "ACCESS_EXPIRED";
  if (input.planQuotaRemaining <= 0) return "PLAN_QUOTA_EXHAUSTED";
  if (input.availableMailboxes <= 0) return "NO_AVAILABLE_MAILBOXES";
  if (input.mailboxesWithDailyCapacity <= 0) return "MAILBOX_DAILY_LIMITS_EXHAUSTED";
  if (!input.withinSendWindow) return "OUTSIDE_SEND_WINDOW";
  return "PROCESSING";
}
