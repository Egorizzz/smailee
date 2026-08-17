"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { issueAuthToken } from "@/lib/authTokens";
import { config } from "@/lib/config";
import {
  ensureTelegramPolling,
  getTelegramWebhookInfo,
  sendTelegramMessage,
} from "@/lib/services/telegram";

const CONNECT_TTL_MS = 15 * 60_000;

export async function createTelegramConnectLink(): Promise<{ url?: string; error?: string }> {
  const { actor } = await requireWorkspace();
  if (!config.telegram.botToken) {
    return { error: "Telegram-бот ещё не настроен администратором Smailee" };
  }
  try {
    const [{ username }, rawToken] = await Promise.all([
      ensureTelegramPolling(),
      issueAuthToken(actor.id, "TELEGRAM_CONNECT", CONNECT_TTL_MS),
    ]);
    return { url: `https://t.me/${username}?start=${rawToken}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось подготовить подключение" };
  }
}

export async function disconnectTelegram(): Promise<{ ok?: string; error?: string }> {
  const { actor } = await requireWorkspace();
  const chatId = actor.telegramChatId;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: actor.id },
      data: { telegramChatId: null, telegramUsername: null, telegramConnectedAt: null },
    }),
    prisma.customerNotificationDelivery.updateMany({
      where: { recipientId: actor.id, channel: "TELEGRAM", sentAt: null, canceledAt: null },
      data: { canceledAt: new Date(), lockedUntil: null, lastError: "Telegram disconnected" },
    }),
  ]);
  if (chatId && config.telegram.botToken) {
    await sendTelegramMessage(chatId, "Уведомления Smailee отключены. Подключить их снова можно в кабинете.").catch(() => undefined);
  }
  revalidatePath("/app/integrations");
  revalidatePath("/app/integrations/telegram");
  revalidatePath("/app/settings/notifications");
  return { ok: "Telegram отключён" };
}

export async function repairTelegramBot(): Promise<{ ok?: string; error?: string }> {
  const { actor } = await requireWorkspace();
  if (!config.telegram.botToken) {
    return { error: "TELEGRAM_BOT_TOKEN не задан в окружении приложения" };
  }

  try {
    await ensureTelegramPolling();
    const webhook = await getTelegramWebhookInfo();
    if (webhook.url) {
      return { error: "Worker ещё не переключил бота на надёжный режим. Перезапустите приложение." };
    }

    if (actor.telegramChatId) {
      await sendTelegramMessage(
        actor.telegramChatId,
        "✅ <b>Связь с Smailee восстановлена</b>\n\nОтправьте /status — бот должен сразу ответить."
      );
      return { ok: "Бот отвечает через worker. Тестовое сообщение отправлено в Telegram." };
    }

    return { ok: "Бот готов. Теперь откройте ссылку подключения и нажмите Start." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось восстановить Telegram-бота" };
  }
}
