import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { sendSystemMail } from "@/lib/systemMail";

const MAX_BATCH = 20;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

async function organizationAdminEmails(ownerId: string): Promise<string[]> {
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { email: true, organizationId: true },
  });
  if (!owner) return [];

  const recipients = new Set([owner.email]);
  if (owner.organizationId) {
    const admins = await prisma.user.findMany({
      where: { organizationId: owner.organizationId, organizationRole: "ORG_ADMIN" },
      select: { email: true },
    });
    for (const admin of admins) recipients.add(admin.email);
  }
  return [...recipients];
}

/**
 * Adds one technical alert per resource/type/24 hours. The database unique key
 * makes the limit survive worker restarts and multiple application replicas.
 */
export async function queueTechnicalAlert(input: {
  ownerId: string;
  type: string;
  resourceKey: string;
  subject: string;
  text: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const recipientEmails = await organizationAdminEmails(input.ownerId);
  return queueAlert({ ...input, userId: input.ownerId, recipientEmails, now });
}

/** Queues a product-wide technical alert to the existing ADMIN_EMAIL. */
export async function queueGlobalTechnicalAlert(input: {
  type: string;
  resourceKey: string;
  subject: string;
  text: string;
  now?: Date;
}) {
  const recipientEmails = config.adminEmail ? [config.adminEmail] : [];
  return queueAlert({ ...input, userId: null, recipientEmails, now: input.now ?? new Date() });
}

async function queueAlert(input: {
  userId: string | null;
  recipientEmails: string[];
  type: string;
  resourceKey: string;
  subject: string;
  text: string;
  now: Date;
}) {
  if (input.recipientEmails.length === 0) return false;

  const dedupeKey = `${input.type}:${input.resourceKey}`;
  const cooldownCutoff = new Date(input.now.getTime() - 24 * 60 * 60_000);
  try {
    const existing = await prisma.adminNotification.findUnique({ where: { dedupeKey } });
    if (existing && existing.createdAt > cooldownCutoff) return false;
    if (existing) {
      await prisma.adminNotification.update({
        where: { id: existing.id },
        data: {
          userId: input.userId,
          recipientEmails: input.recipientEmails,
          subject: input.subject,
          text: input.text,
          attempts: 0,
          nextAttemptAt: input.now,
          sentAt: null,
          lastError: null,
          createdAt: input.now,
        },
      });
    } else {
      await prisma.adminNotification.create({ data: {
        userId: input.userId,
        type: input.type,
        dedupeKey,
        recipientEmails: input.recipientEmails,
        subject: input.subject,
        text: input.text,
      } });
    }
    return true;
  } catch (error) {
    // P2002 means today's notification already exists: this is expected dedupe.
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") return false;
    throw error;
  }
}

function retryDelay(attempt: number) {
  return Math.min(
    config.adminNotifications.retryMaxMs,
    config.adminNotifications.retryBaseMs * 2 ** Math.max(0, attempt - 1),
  );
}

/**
 * Sends pending technical alerts through SYSTEM_SMTP/no-reply. Alerts for the
 * same recipient set are combined into one digest so a provider-wide outage
 * does not produce one email per mailbox.
 */
export async function deliverAdminNotifications(
  now = new Date(),
  sender: typeof sendSystemMail = sendSystemMail,
) {
  const pending = await prisma.adminNotification.findMany({
    where: { sentAt: null, nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: MAX_BATCH,
  });

  const groups = new Map<string, typeof pending>();
  for (const notification of pending) {
    const key = JSON.stringify([...notification.recipientEmails].sort());
    const group = groups.get(key) ?? [];
    group.push(notification);
    groups.set(key, group);
  }

  let sent = 0;
  let failed = 0;
  let emails = 0;
  for (const notifications of groups.values()) {
    const claimedNotifications = [];
    // Claim before sending: if the product is ever run in several replicas,
    // only one worker may deliver each row. Failed delivery below schedules a
    // normal retry; a crashed worker releases its claims after 10 minutes.
    for (const notification of notifications) {
      const claimed = await prisma.adminNotification.updateMany({
        where: { id: notification.id, sentAt: null, nextAttemptAt: { lte: now } },
        data: { nextAttemptAt: new Date(now.getTime() + 10 * 60_000) },
      });
      if (claimed.count === 1) claimedNotifications.push(notification);
    }
    if (claimedNotifications.length === 0) continue;

    const digest = claimedNotifications
      .map((notification) =>
        claimedNotifications.length === 1
          ? notification.text
          : `${notification.subject}\n\n${notification.text}`,
      )
      .join("\n\n────────────────────\n\n");
    const subject = claimedNotifications.length === 1
      ? claimedNotifications[0].subject
      : `[Smailee] Технические уведомления (${claimedNotifications.length})`;

    const result = await sender({
      to: claimedNotifications[0].recipientEmails,
      subject,
      text: digest,
      html: `<p>${escapeHtml(digest).replace(/\n/g, "<br>")}</p>`,
    });
    if (result.ok) {
      await prisma.adminNotification.updateMany({
        where: { id: { in: claimedNotifications.map((notification) => notification.id) } },
        data: { sentAt: now, lastError: null, attempts: { increment: 1 } },
      });
      sent += claimedNotifications.length;
      emails++;
    } else {
      for (const notification of claimedNotifications) {
        const attempt = notification.attempts + 1;
        await prisma.adminNotification.update({
          where: { id: notification.id },
          data: {
            attempts: attempt,
            lastError: result.error.slice(0, 1000),
            nextAttemptAt: new Date(now.getTime() + retryDelay(attempt)),
          },
        });
      }
      failed += claimedNotifications.length;
    }
  }
  return { checked: pending.length, sent, failed, emails };
}
