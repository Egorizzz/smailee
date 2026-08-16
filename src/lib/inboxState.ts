export const FROZEN_AFTER_DAYS = 7;

export type InboxThreadItem = {
  direction: string;
  status: string;
  createdAt: Date;
};

export type AutoPingLifecycleState = "active" | "exhausted" | "off";

export function autoPingLifecycleState(
  message: {
    aiRepliesEnabled?: boolean;
    autoPingEnabled: boolean | null;
    autoPingAttempts: number;
    autoPingMaxAttempts: number | null;
    autoPingStoppedAt: Date | null;
  },
  defaults: { enabled: boolean; maxAttempts: number },
): AutoPingLifecycleState {
  const enabled = message.autoPingEnabled ?? defaults.enabled;
  const maxAttempts = message.autoPingMaxAttempts ?? defaults.maxAttempts;
  if (!enabled || message.aiRepliesEnabled === false) return "off";
  // Attempts are the source of truth. `autoPingStoppedAt` can still be null when
  // an administrator lowers the shared attempt limit after pings were sent.
  if (message.autoPingAttempts >= maxAttempts) return "exhausted";
  if (!message.autoPingStoppedAt && message.autoPingAttempts < maxAttempts) return "active";
  return "off";
}

type ConversationLeadState = {
  qualification: string;
  processedAt: Date | null;
  handedOffAt?: Date | null;
} | null;

export function latestInboundAt(thread: InboxThreadItem[]): Date | null {
  return thread.reduce<Date | null>((latest, item) => {
    if (item.direction !== "inbound") return latest;
    return !latest || item.createdAt > latest ? item.createdAt : latest;
  }, null);
}

export function latestSentOutboundAt(thread: InboxThreadItem[]): Date | null {
  return thread.reduce<Date | null>((latest, item) => {
    if (item.direction !== "outbound" || item.status !== "SENT") return latest;
    return !latest || item.createdAt > latest ? item.createdAt : latest;
  }, null);
}

export function hasInboundReply(thread: InboxThreadItem[]): boolean {
  return thread.some((item) => item.direction === "inbound");
}

/**
 * Диалог требует действия только когда последнее реальное сообщение пришло от
 * клиента. Черновик ИИ не считается ответом; отправленное исходящее — считается.
 */
export function isConversationUnanswered(thread: InboxThreadItem[]): boolean {
  const inboundAt = latestInboundAt(thread);
  if (!inboundAt) return false;
  const outboundAt = latestSentOutboundAt(thread);
  return !outboundAt || outboundAt < inboundAt;
}

export function isConversationFrozen(
  conversation: {
    thread: InboxThreadItem[];
    lead: ConversationLeadState;
    refusedAt?: Date | null;
    nextContactAt?: Date | null;
  },
  now = new Date(),
  thresholdDays = FROZEN_AFTER_DAYS,
): boolean {
  if (
    conversation.refusedAt ||
    conversation.lead?.processedAt ||
    conversation.lead?.handedOffAt
  ) return false;

  const inboundAt = latestInboundAt(conversation.thread);
  const outboundAt = latestSentOutboundAt(conversation.thread);
  if (!inboundAt || !outboundAt || outboundAt <= inboundAt) return false;
  if (conversation.nextContactAt && conversation.nextContactAt > now) return false;

  return now.getTime() - outboundAt.getTime() >= thresholdDays * 24 * 60 * 60_000;
}

export function inboxBadgeCounts(conversations: Array<{
  thread: InboxThreadItem[];
  lead: ConversationLeadState;
  refusedAt?: Date | null;
}>) {
  let unanswered = 0;
  let warm = 0;
  for (const conversation of conversations) {
    if (
      conversation.refusedAt ||
      conversation.lead?.processedAt ||
      conversation.lead?.handedOffAt ||
      !isConversationUnanswered(conversation.thread)
    ) continue;
    if (conversation.lead?.qualification === "HOT") warm += 1;
    else unanswered += 1;
  }
  return { unanswered, warm };
}
