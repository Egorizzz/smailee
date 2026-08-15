import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import {
  isPermanentAdminTelegramError,
  sendAdminTelegramMessage,
} from "@/lib/services/adminTelegram";
import { escapeTelegramHtml } from "@/lib/services/telegram";

const MAX_BATCH = 30;

type AdminTelegramNotification = {
  type: string;
  text: string;
  buttonText?: string;
  buttonUrl?: string;
};

export async function queueAdminTelegramNotification(input: AdminTelegramNotification): Promise<number> {
  const queuedAt = new Date();
  const recipients = await prisma.adminTelegramRecipient.findMany({
    where: { revokedAt: null },
    select: { id: true },
  });
  if (recipients.length === 0) return 0;

  const result = await prisma.adminTelegramDelivery.createMany({
    data: recipients.map((recipient) => ({
      recipientId: recipient.id,
      type: input.type,
      text: input.text,
      buttonText: input.buttonText ?? null,
      buttonUrl: input.buttonUrl ?? null,
      // Используем часы приложения и для постановки, и для выборки очереди.
      // Иначе небольшое расхождение времени Node/Postgres может отложить только
      // что созданную доставку до следующего прохода воркера.
      nextAttemptAt: queuedAt,
    })),
  });
  return result.count;
}

export async function queueLandingLeadTelegramNotification(input: {
  id: string;
  name: string;
  email: string;
  messenger: string | null;
  company: string | null;
  source: string | null;
}) {
  const details = [
    `👤 ${escapeTelegramHtml(input.name)}`,
    input.company ? `🏢 ${escapeTelegramHtml(input.company)}` : "",
    input.email ? `✉️ ${escapeTelegramHtml(input.email)}` : "",
    input.messenger ? `💬 ${escapeTelegramHtml(input.messenger)}` : "",
    input.source ? `Источник: ${escapeTelegramHtml(input.source)}` : "",
  ].filter(Boolean);
  return queueAdminTelegramNotification({
    type: "LANDING_LEAD",
    text: `🔥 <b>Новая заявка с сайта</b>\n\n${details.join("\n")}`,
    buttonText: "Открыть заявку",
    buttonUrl: `${config.appUrl.replace(/\/$/, "")}/app/admin#landing-lead-${input.id}`,
  });
}

export async function queueSetupRequestTelegramNotification(input: {
  id: string;
  userEmail: string;
  name: string;
  contact: string;
  preferredTime: string | null;
}) {
  const details = [
    `Кабинет: ${escapeTelegramHtml(input.userEmail)}`,
    `👤 ${escapeTelegramHtml(input.name)}`,
    `💬 ${escapeTelegramHtml(input.contact)}`,
    input.preferredTime ? `🕐 ${escapeTelegramHtml(input.preferredTime)}` : "",
  ].filter(Boolean);
  return queueAdminTelegramNotification({
    type: "SETUP_HELP_REQUEST",
    text: `🛠 <b>Нужна помощь с инфраструктурой</b>\n\n${details.join("\n")}`,
    buttonText: "Открыть заявку",
    buttonUrl: `${config.appUrl.replace(/\/$/, "")}/app/admin#setup-request-${input.id}`,
  });
}

function retryDelay(attempt: number) {
  return Math.min(
    config.adminTelegram.retryMaxMs,
    config.adminTelegram.retryBaseMs * 2 ** Math.max(0, attempt - 1),
  );
}

export async function deliverAdminTelegramNotifications(
  now = new Date(),
  sender: typeof sendAdminTelegramMessage = sendAdminTelegramMessage,
) {
  if (!config.adminTelegram.botToken && sender === sendAdminTelegramMessage) {
    return { checked: 0, sent: 0, failed: 0, revoked: 0 };
  }

  const pending = await prisma.adminTelegramDelivery.findMany({
    where: {
      sentAt: null,
      discardedAt: null,
      nextAttemptAt: { lte: now },
      recipient: { revokedAt: null },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_BATCH,
    include: { recipient: { select: { id: true, chatId: true } } },
  });

  let sent = 0;
  let failed = 0;
  let revoked = 0;
  for (const delivery of pending) {
    const claimed = await prisma.adminTelegramDelivery.updateMany({
      where: {
        id: delivery.id,
        sentAt: null,
        discardedAt: null,
        nextAttemptAt: { lte: now },
      },
      data: { nextAttemptAt: new Date(now.getTime() + 10 * 60_000) },
    });
    if (claimed.count !== 1) continue;

    try {
      await sender(delivery.recipient.chatId, delivery.text, {
        replyMarkup: delivery.buttonText && delivery.buttonUrl
          ? { inline_keyboard: [[{ text: delivery.buttonText, url: delivery.buttonUrl }]] }
          : undefined,
      });
      await prisma.adminTelegramDelivery.update({
        where: { id: delivery.id },
        data: { sentAt: now, attempts: { increment: 1 }, lastError: null },
      });
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isPermanentAdminTelegramError(error)) {
        await prisma.$transaction([
          prisma.adminTelegramRecipient.update({
            where: { id: delivery.recipient.id },
            data: { revokedAt: now },
          }),
          prisma.adminTelegramDelivery.updateMany({
            where: {
              recipientId: delivery.recipient.id,
              sentAt: null,
              discardedAt: null,
            },
            data: { discardedAt: now, lastError: message.slice(0, 1000) },
          }),
        ]);
        revoked++;
      } else {
        const attempt = delivery.attempts + 1;
        await prisma.adminTelegramDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts: attempt,
            lastError: message.slice(0, 1000),
            nextAttemptAt: new Date(now.getTime() + retryDelay(attempt)),
          },
        });
        failed++;
      }
    }
  }
  return { checked: pending.length, sent, failed, revoked };
}
