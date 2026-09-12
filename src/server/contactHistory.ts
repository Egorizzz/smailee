import { Prisma, type LeadQualification } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const RESERVED_MESSAGE_STATUSES = [
  "PENDING",
  "QUEUED",
  "SENDING",
  "SENT",
  "DELIVERED",
  "OPENED",
  "CLICKED",
  "REPLIED",
  "BOUNCED",
] as const;
const SENT_MESSAGE_STATUSES = [
  "SENT",
  "DELIVERED",
  "OPENED",
  "CLICKED",
  "REPLIED",
] as const;

export type RelationshipMemory = {
  previousEmails: Array<{ subject: string; body: string }>;
  contactFacts: string[];
  companyFacts: string[];
};

export type ContactHistorySnapshot = {
  state:
    | "new"
    | "contacted"
    | "active"
    | "warm"
    | "handed_off"
    | "processed"
    | "refused"
    | "complained";
  summary: string | null;
  stats: { campaigns: number; sent: number; replies: number };
  events: Array<{
    id: string;
    title: string;
    detail: string | null;
    at: string;
    campaignId: string | null;
  }>;
  company: null | {
    contacts: number;
    activeDialog: boolean;
    events: Array<{ id: string; title: string; detail: string; at: string }>;
  };
};

export async function blockedCompanyIdsForCampaign(
  userId: string,
): Promise<string[]> {
  const [messages, handedOffEvents] = await Promise.all([
    prisma.message.findMany({
      where: {
        campaign: { userId, isDemo: false },
        contact: { sourceCompanyId: { not: null } },
        thread: { some: { direction: "inbound" } },
      },
      select: {
        contact: { select: { sourceCompanyId: true } },
        lead: { select: { processedAt: true, handedOffAt: true } },
      },
    }),
    prisma.companyEngagementEvent.findMany({
      where: { userId, kind: "CRM_HANDOFF" },
      select: { companyId: true },
    }),
  ]);
  const ids = new Set(handedOffEvents.map((event) => event.companyId));
  for (const message of messages) {
    if (!message.contact.sourceCompanyId) continue;
    if (!message.lead?.processedAt || message.lead.handedOffAt)
      ids.add(message.contact.sourceCompanyId);
  }
  return [...ids];
}

export function campaignHistoryEligibilityWhere(
  blockedCompanyIds: string[],
): Prisma.ContactWhereInput {
  return {
    messages: {
      none: {
        campaign: { isDemo: false },
        status: { in: [...RESERVED_MESSAGE_STATUSES] },
      },
    },
    ...(blockedCompanyIds.length
      ? { NOT: { sourceCompanyId: { in: blockedCompanyIds } } }
      : {}),
  };
}

export async function pauseParallelCompanyOutreach(input: {
  userId: string;
  companyId: string | null;
  replyingContactId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const scope = {
    campaign: { userId: input.userId, isDemo: false },
    ...(input.companyId
      ? { contact: { sourceCompanyId: input.companyId } }
      : { contactId: input.replyingContactId }),
  } satisfies Prisma.MessageWhereInput;
  const [cancelled, stoppedChains] = await prisma.$transaction([
    prisma.message.updateMany({
      where: { ...scope, status: { in: ["PENDING", "QUEUED"] } },
      data: { status: "CANCELLED", error: "company conversation started" },
    }),
    prisma.message.updateMany({
      where: {
        ...scope,
        status: { in: [...SENT_MESSAGE_STATUSES] },
        followupSentAt: null,
      },
      data: { followupSentAt: now },
    }),
  ]);
  return { cancelled: cancelled.count, stoppedChains: stoppedChains.count };
}

export async function recordCompanyEngagement(input: {
  userId: string;
  companyId: string | null;
  contactId: string;
  contactEmail: string;
  contactName: string | null;
  sourceReplyId?: string | null;
  kind: "REPLY" | "DECLINED" | "OPT_OUT" | "SPAM_COMPLAINT" | "CRM_HANDOFF";
  summary: string;
  qualification?: LeadQualification | null;
  occurredAt?: Date;
}) {
  if (!input.companyId) return;
  const data = {
    userId: input.userId,
    companyId: input.companyId,
    contactId: input.contactId,
    contactEmail: input.contactEmail.toLowerCase(),
    contactName: input.contactName,
    sourceReplyId: input.sourceReplyId ?? null,
    kind: input.kind,
    summary: compact(input.summary, 1_000) || "Получен ответ",
    qualification: input.qualification ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  } as const;
  try {
    await prisma.companyEngagementEvent.create({ data });
  } catch (error) {
    if (!(
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ))
      throw error;
  }
}

export async function registerSpamComplaint(
  userId: string,
  email: string,
  now = new Date(),
) {
  const normalized = email.trim().toLowerCase();
  const contacts = await prisma.contact.findMany({
    where: { userId, email: normalized },
    select: { id: true, name: true, sourceCompanyId: true },
  });
  await prisma.$transaction([
    prisma.contact.updateMany({
      where: { userId, email: normalized },
      data: { status: "COMPLAINED" },
    }),
    prisma.suppression.upsert({
      where: { userId_email: { userId, email: normalized } },
      update: { reason: "complained", releasedAt: null },
      create: { userId, email: normalized, reason: "complained" },
    }),
    prisma.message.updateMany({
      where: {
        campaign: { userId, isDemo: false },
        contact: { email: normalized },
        status: { in: ["PENDING", "QUEUED"] },
      },
      data: {
        status: "CANCELLED",
        error: "spam complaint",
        autoPingNextAt: null,
        autoPingStoppedAt: now,
      },
    }),
  ]);
  return contacts;
}

export async function loadRelationshipMemory(input: {
  userId: string;
  contactId: string;
  companyId: string | null;
  excludeMessageId?: string;
}): Promise<RelationshipMemory> {
  const [messages, companyEvents] = await Promise.all([
    prisma.message.findMany({
      where: {
        contactId: input.contactId,
        campaign: { userId: input.userId, isDemo: false },
        sentAt: { not: null },
        ...(input.excludeMessageId
          ? { id: { not: input.excludeMessageId } }
          : {}),
      },
      select: {
        subject: true,
        body: true,
        sentAt: true,
        lead: { select: { summary: true } },
      },
      orderBy: { sentAt: "desc" },
      take: 4,
    }),
    input.companyId
      ? prisma.companyEngagementEvent.findMany({
          where: { userId: input.userId, companyId: input.companyId },
          orderBy: { occurredAt: "desc" },
          take: 6,
          select: { contactId: true, summary: true, qualification: true },
        })
      : Promise.resolve([]),
  ]);
  return {
    previousEmails: messages
      .slice(0, 3)
      .reverse()
      .map((message) => ({
        subject: compact(message.subject, 240),
        body: compact(message.body, 2_000),
      })),
    contactFacts: unique(
      messages.flatMap((message) =>
        message.lead?.summary ? [compact(message.lead.summary, 500)] : [],
      ),
    ).slice(0, 3),
    companyFacts: unique(
      companyEvents.map((event) => compact(event.summary, 500)),
    ).slice(0, 4),
  };
}

export async function loadContactHistorySnapshot(
  userId: string,
  contactId: string,
): Promise<ContactHistorySnapshot | null> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId },
    select: {
      id: true,
      status: true,
      sourceCompanyId: true,
      messages: {
        where: { campaign: { isDemo: false } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          subject: true,
          status: true,
          sentAt: true,
          openedAt: true,
          clickedAt: true,
          refusedAt: true,
          campaign: { select: { id: true, name: true } },
          lead: {
            select: {
              qualification: true,
              summary: true,
              processedAt: true,
              handedOffAt: true,
            },
          },
          thread: {
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
              id: true,
              direction: true,
              body: true,
              status: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });
  if (!contact) return null;

  const companyData = contact.sourceCompanyId
    ? await Promise.all([
        prisma.contact.count({
          where: { userId, sourceCompanyId: contact.sourceCompanyId },
        }),
        prisma.companyEngagementEvent.findMany({
          where: { userId, companyId: contact.sourceCompanyId },
          orderBy: { occurredAt: "desc" },
          take: 8,
          select: {
            id: true,
            kind: true,
            summary: true,
            occurredAt: true,
            contactEmail: true,
            contactName: true,
          },
        }),
        blockedCompanyIdsForCampaign(userId),
      ])
    : null;

  const events = contact.messages
    .flatMap((message) => {
      const result: ContactHistorySnapshot["events"] = [];
      if (message.sentAt)
        result.push({
          id: `sent:${message.id}`,
          title: "Письмо отправлено",
          detail: `${message.campaign.name} · ${message.subject}`,
          at: message.sentAt.toISOString(),
          campaignId: message.campaign.id,
        });
      for (const reply of message.thread) {
        if (reply.status !== "SENT") continue;
        result.push({
          id: reply.id,
          title:
            reply.direction === "inbound" ? "Получен ответ" : "Ответ отправлен",
          detail: compact(reply.body, 180),
          at: reply.createdAt.toISOString(),
          campaignId: message.campaign.id,
        });
      }
      if (message.lead?.handedOffAt)
        result.push({
          id: `crm:${message.id}`,
          title: "Передан менеджеру",
          detail: message.lead.summary,
          at: message.lead.handedOffAt.toISOString(),
          campaignId: message.campaign.id,
        });
      return result;
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);

  const leads = contact.messages.flatMap((message) =>
    message.lead ? [message.lead] : [],
  );
  const replies = contact.messages.reduce(
    (sum, message) =>
      sum +
      message.thread.filter((reply) => reply.direction === "inbound").length,
    0,
  );
  const latestSummary =
    contact.messages.find((message) => message.lead?.summary)?.lead?.summary ??
    null;
  const active = contact.messages.some(
    (message) =>
      message.thread.some((reply) => reply.direction === "inbound") &&
      !message.refusedAt &&
      !message.lead?.processedAt &&
      !message.lead?.handedOffAt,
  );
  const state: ContactHistorySnapshot["state"] =
    contact.status === "COMPLAINED"
      ? "complained"
      : contact.status === "UNSUBSCRIBED"
        ? "refused"
        : leads.some((lead) => lead.handedOffAt)
          ? "handed_off"
          : active
            ? "active"
            : leads.some((lead) => lead.qualification === "HOT")
              ? "warm"
              : leads.some((lead) => lead.processedAt)
                ? "processed"
                : contact.messages.some((message) => message.sentAt)
                  ? "contacted"
                  : "new";

  return {
    state,
    summary: latestSummary,
    stats: {
      campaigns: new Set(contact.messages.map((message) => message.campaign.id))
        .size,
      sent: contact.messages.filter((message) => message.sentAt).length,
      replies,
    },
    events,
    company: companyData
      ? {
          contacts: companyData[0],
          activeDialog: companyData[2].includes(contact.sourceCompanyId!),
          events: companyData[1].map((event) => ({
            id: event.id,
            title: companyEventTitle(event.kind),
            detail: `${event.contactName || event.contactEmail}: ${compact(event.summary, 220)}`,
            at: event.occurredAt.toISOString(),
          })),
        }
      : null,
  };
}

function companyEventTitle(kind: string) {
  return (
    (
      {
        REPLY: "Ответ от компании",
        DECLINED: "Компания отказалась",
        OPT_OUT: "Контакт попросил не писать",
        SPAM_COMPLAINT: "Жалоба на спам",
        CRM_HANDOFF: "Компания передана менеджеру",
      } as Record<string, string>
    )[kind] ?? "Событие компании"
  );
}

function compact(value: string | null | undefined, max: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
