import type {
  CustomerNotificationCategory,
  CustomerNotificationMode,
  LeadQualification,
  User,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { nextDigestAt, nextTelegramGroupAt, notificationCategoryForReply } from "@/lib/customerNotificationSchedule";
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/services/telegram";
import { sendSystemMail } from "@/lib/systemMail";

const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;
const LOCK_MS = 2 * 60_000;
// С запасом укладываемся в лимит Telegram 4096 символов даже с длинными
// именами, названиями кампаний и превью каждого ответа.
const MAX_ITEMS_PER_MESSAGE = 12;

type QueueInput = {
  ownerId: string;
  campaignCreatedById: string | null;
  sourceReplyId: string;
  previousQualification: LeadQualification | null;
  currentQualification: LeadQualification | null;
  actionRequired: boolean;
  now?: Date;
};

function canReceiveOwn(user: User) {
  return hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "LEADS_REPLY_OWN");
}

function canReceiveAll(user: User) {
  return hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "LEADS_REPLY_ALL");
}

function isOwnCampaign(user: User, ownerId: string, createdById: string | null) {
  return createdById ? createdById === user.id : user.id === ownerId;
}

function telegramMode(user: User, category: CustomerNotificationCategory): CustomerNotificationMode {
  return category === "WARM_LEAD" ? user.telegramWarmLeadMode : user.telegramReplyMode;
}

function emailEnabled(user: User, category: CustomerNotificationCategory) {
  return category === "WARM_LEAD" ? user.emailDigestWarmLeads : user.emailDigestReplies;
}

/**
 * Ставит персональные доставки в очередь после того, как входящий ответ уже
 * сохранён и квалифицирован. Права проверяются здесь, а не только в UI.
 */
export async function enqueueCustomerReplyNotification(input: QueueInput) {
  const now = input.now ?? new Date();
  const category = notificationCategoryForReply(input.previousQualification, input.currentQualification);
  const owner = await prisma.user.findUnique({ where: { id: input.ownerId } });
  if (!owner) return { category, queued: 0 };

  const recipients = owner.organizationId
    ? await prisma.user.findMany({ where: { organizationId: owner.organizationId } })
    : [owner];

  let queued = 0;
  for (const recipient of recipients) {
    const hasAllAccess = canReceiveAll(recipient);
    const inScope = recipient.customerNotificationScope === "ALL" && hasAllAccess
      ? true
      : canReceiveOwn(recipient) && isOwnCampaign(recipient, input.ownerId, input.campaignCreatedById);
    if (!inScope) continue;
    if (category === "REPLY" && recipient.replyNotificationPolicy === "ACTION_REQUIRED" && !input.actionRequired) continue;

    const mode = telegramMode(recipient, category);
    // Событие не теряется при временно отсутствующем токене бота: доставка
    // останется в очереди и повторится после восстановления конфигурации.
    if (recipient.telegramChatId && mode !== "OFF") {
      const deliverAfter = mode === "IMMEDIATE" ? now : nextTelegramGroupAt(now, recipient.telegramGroupMinutes);
      await prisma.customerNotificationDelivery.upsert({
        where: {
          recipientId_sourceReplyId_channel: {
            recipientId: recipient.id,
            sourceReplyId: input.sourceReplyId,
            channel: "TELEGRAM",
          },
        },
        create: {
          recipientId: recipient.id,
          sourceReplyId: input.sourceReplyId,
          category,
          channel: "TELEGRAM",
          deliverAfter,
          nextAttemptAt: now,
        },
        update: { category, deliverAfter, nextAttemptAt: now, canceledAt: null },
      });
      queued++;
    }

    if (emailEnabled(recipient, category)) {
      const deliverAfter = nextDigestAt(now, recipient.emailDigestFrequency, recipient.emailDigestHourMsk);
      await prisma.customerNotificationDelivery.upsert({
        where: {
          recipientId_sourceReplyId_channel: {
            recipientId: recipient.id,
            sourceReplyId: input.sourceReplyId,
            channel: "EMAIL",
          },
        },
        create: {
          recipientId: recipient.id,
          sourceReplyId: input.sourceReplyId,
          category,
          channel: "EMAIL",
          deliverAfter,
          nextAttemptAt: now,
        },
        update: { category, deliverAfter, nextAttemptAt: now, canceledAt: null },
      });
      queued++;
    }
  }
  return { category, queued };
}

function retryAt(attempts: number, now: Date) {
  return new Date(now.getTime() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempts, 8)));
}

function html(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clip(value: string | null | undefined, max = 180) {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function person(item: NotificationItem) {
  const contact = item.sourceReply.message.contact;
  return contact.name || contact.company || contact.email;
}

function itemUrl(item: NotificationItem) {
  return `${config.appUrl.replace(/\/$/, "")}/app/inbox?thread=${item.sourceReply.message.id}`;
}

type NotificationItem = Awaited<ReturnType<typeof loadDue>>[number];

async function loadDue(channel: "TELEGRAM" | "EMAIL", now: Date) {
  return prisma.customerNotificationDelivery.findMany({
    where: {
      channel,
      sentAt: null,
      canceledAt: null,
      deliverAfter: { lte: now },
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
    include: {
      recipient: true,
      sourceReply: {
        include: {
          message: {
            include: {
              contact: true,
              campaign: true,
              lead: true,
              thread: {
                where: { direction: "outbound", status: "DRAFT" },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      },
    },
    orderBy: [{ deliverAfter: "asc" }, { createdAt: "asc" }],
    take: 200,
  });
}

async function keepAuthorized(items: NotificationItem[], now: Date) {
  const valid: NotificationItem[] = [];
  const invalid: NotificationItem[] = [];
  for (const item of items) {
    const recipient = item.recipient;
    const campaign = item.sourceReply.message.campaign;
    const allowed = recipient.customerNotificationScope === "ALL" && canReceiveAll(recipient)
      ? true
      : canReceiveOwn(recipient) && isOwnCampaign(recipient, campaign.userId, campaign.createdById);
    (allowed ? valid : invalid).push(item);
  }
  if (invalid.length) {
    await prisma.customerNotificationDelivery.updateMany({
      where: { id: { in: invalid.map((item) => item.id) }, sentAt: null, canceledAt: null },
      data: { canceledAt: now, lockedUntil: null, lastError: "Access revoked before delivery" },
    });
  }
  return valid;
}

async function claim(items: NotificationItem[], now: Date) {
  if (!items.length) return false;
  const result = await prisma.customerNotificationDelivery.updateMany({
    where: {
      id: { in: items.map((item) => item.id) },
      sentAt: null,
      canceledAt: null,
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  return result.count === items.length;
}

async function sent(items: NotificationItem[], now: Date) {
  await prisma.customerNotificationDelivery.updateMany({
    where: { id: { in: items.map((item) => item.id) } },
    data: { sentAt: now, lockedUntil: null, lastError: null },
  });
}

async function failed(items: NotificationItem[], error: unknown, now: Date) {
  const message = error instanceof Error ? error.message : String(error);
  await Promise.all(items.map((item) => prisma.customerNotificationDelivery.update({
    where: { id: item.id },
    data: {
      attempts: { increment: 1 },
      nextAttemptAt: retryAt(item.attempts + 1, now),
      lockedUntil: null,
      lastError: message.slice(0, 1000),
    },
  })));
  return message;
}

function telegramText(category: CustomerNotificationCategory, items: NotificationItem[]) {
  const warm = category === "WARM_LEAD";
  const title = warm ? "🔥 <b>Тёплые лиды" : "💬 <b>Новые ответы";
  const shown = items.slice(0, MAX_ITEMS_PER_MESSAGE);
  const lines = shown.flatMap((item, index) => {
    const message = item.sourceReply.message;
    const detail = warm
      ? clip(message.lead?.summary || item.sourceReply.body)
      : clip(item.sourceReply.body);
    const action = warm
      ? "Переведён в статус тёплого лида"
      : message.thread.length > 0
        ? "Черновик ответа ждёт проверки"
        : "Откройте диалог и проверьте ответ";
    return [
      "",
      `<b>${index + 1}. ${escapeTelegramHtml(person(item))}</b>`,
      `<i>${escapeTelegramHtml(message.campaign.name)}</i>`,
      detail ? escapeTelegramHtml(detail) : null,
      `→ ${escapeTelegramHtml(action)}`,
    ].filter((line): line is string => Boolean(line));
  });
  if (items.length > shown.length) lines.push("", `Ещё ${items.length - shown.length} — в Inbox`);
  return [`${title} (${items.length})</b>`, ...lines].join("\n");
}

function emailSection(title: string, items: NotificationItem[]) {
  if (!items.length) return "";
  return `<h2 style="font-size:18px;margin:28px 0 12px;color:#17221f">${html(title)} (${items.length})</h2>${items.map((item) => {
    const message = item.sourceReply.message;
    const detail = item.category === "WARM_LEAD" ? message.lead?.summary || item.sourceReply.body : item.sourceReply.body;
    return `<div style="border-top:1px solid #e5ebe8;padding:14px 0"><div style="font-weight:700;color:#17221f">${html(person(item))}</div><div style="font-size:13px;color:#66736e;margin-top:2px">${html(message.campaign.name)}</div><p style="margin:8px 0;color:#34423d;line-height:1.5">${html(clip(detail, 300))}</p><a href="${html(itemUrl(item))}" style="color:#17754a;font-weight:600">Открыть диалог →</a></div>`;
  }).join("")}`;
}

async function deliverTelegram(now: Date) {
  const loaded = await loadDue("TELEGRAM", now);
  const due = await keepAuthorized(loaded, now);
  const groups = new Map<string, NotificationItem[]>();
  for (const item of due) {
    const key = `${item.recipientId}:${item.category}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  let sentCount = 0;
  let failedCount = 0;
  for (const items of groups.values()) {
    if (!(await claim(items, now))) continue;
    const recipient = items[0].recipient;
    if (!recipient.telegramChatId) {
      await prisma.customerNotificationDelivery.updateMany({
        where: { id: { in: items.map((item) => item.id) } },
        data: { canceledAt: now, lockedUntil: null, lastError: "Telegram disconnected" },
      });
      continue;
    }
    try {
      await sendTelegramMessage(recipient.telegramChatId, telegramText(items[0].category, items), {
        replyMarkup: { inline_keyboard: [[{ text: "Открыть Inbox", url: `${config.appUrl.replace(/\/$/, "")}/app/inbox` }]] },
      });
      await sent(items, now);
      sentCount += items.length;
    } catch (error) {
      const reason = await failed(items, error, now);
      failedCount += items.length;
      if (/bot was blocked|chat not found|user is deactivated/i.test(reason)) {
        await prisma.$transaction([
          prisma.user.update({
            where: { id: recipient.id },
            data: { telegramChatId: null, telegramUsername: null, telegramConnectedAt: null },
          }),
          prisma.customerNotificationDelivery.updateMany({
            where: { recipientId: recipient.id, channel: "TELEGRAM", sentAt: null, canceledAt: null },
            data: { canceledAt: now, lockedUntil: null, lastError: reason.slice(0, 1000) },
          }),
        ]);
      }
    }
  }
  return { checked: loaded.length, sent: sentCount, failed: failedCount };
}

async function deliverEmail(now: Date) {
  const loaded = await loadDue("EMAIL", now);
  const due = await keepAuthorized(loaded, now);
  const groups = new Map<string, NotificationItem[]>();
  for (const item of due) groups.set(item.recipientId, [...(groups.get(item.recipientId) ?? []), item]);

  let sentCount = 0;
  let failedCount = 0;
  for (const items of groups.values()) {
    if (!(await claim(items, now))) continue;
    const recipient = items[0].recipient;
    const warm = items.filter((item) => item.category === "WARM_LEAD");
    const replies = items.filter((item) => item.category === "REPLY");
    const subjectParts = [warm.length ? `${warm.length} тёплых лидов` : null, replies.length ? `${replies.length} ответов` : null].filter(Boolean);
    const result = await sendSystemMail({
      to: recipient.email,
      subject: `Smailee: ${subjectParts.join(" и ")}`,
      text: [
        warm.length ? `Тёплые лиды: ${warm.length}` : null,
        ...warm.map((item) => `- ${person(item)}: ${clip(item.sourceReply.message.lead?.summary || item.sourceReply.body)}`),
        replies.length ? `\nНовые ответы: ${replies.length}` : null,
        ...replies.map((item) => `- ${person(item)}: ${clip(item.sourceReply.body)}`),
        `\nОткрыть Inbox: ${config.appUrl.replace(/\/$/, "")}/app/inbox`,
      ].filter(Boolean).join("\n"),
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#34423d"><h1 style="font-size:22px;color:#17221f">События в Smailee</h1>${emailSection("Тёплые лиды", warm)}${emailSection("Новые ответы", replies)}<p style="margin-top:28px"><a href="${html(`${config.appUrl.replace(/\/$/, "")}/app/inbox`)}" style="display:inline-block;background:#17754a;color:white;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700">Открыть Inbox</a></p></div>`,
    });
    if (result.ok) {
      await sent(items, now);
      sentCount += items.length;
    } else {
      await failed(items, new Error(result.error), now);
      failedCount += items.length;
    }
  }
  return { checked: loaded.length, sent: sentCount, failed: failedCount };
}

export async function deliverCustomerNotifications(now = new Date()) {
  const [telegram, email] = await Promise.all([deliverTelegram(now), deliverEmail(now)]);
  return {
    checked: telegram.checked + email.checked,
    sent: telegram.sent + email.sent,
    failed: telegram.failed + email.failed,
    telegram,
    email,
  };
}
