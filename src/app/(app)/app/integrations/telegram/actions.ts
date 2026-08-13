"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { issueAuthToken } from "@/lib/authTokens";
import { config } from "@/lib/config";
import { ensureTelegramWebhook, sendTelegramMessage } from "@/lib/services/telegram";

const CONNECT_TTL_MS = 15 * 60_000;

export async function createTelegramConnectLink(): Promise<{ url?: string; error?: string }> {
  const { owner } = await requireOrganizationAdmin();
  if (!config.telegram.botToken) {
    return { error: "Telegram-бот ещё не настроен администратором Smailee" };
  }
  try {
    const [{ username }, rawToken] = await Promise.all([
      ensureTelegramWebhook(),
      issueAuthToken(owner.id, "TELEGRAM_CONNECT", CONNECT_TTL_MS),
    ]);
    return { url: `https://t.me/${username}?start=${rawToken}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось подготовить подключение" };
  }
}

export async function disconnectTelegram(): Promise<{ ok?: string; error?: string }> {
  const { owner } = await requireOrganizationAdmin();
  const chatId = owner.telegramChatId;
  await prisma.user.update({
    where: { id: owner.id },
    data: { telegramChatId: null, telegramUsername: null, telegramConnectedAt: null },
  });
  if (chatId && config.telegram.botToken) {
    await sendTelegramMessage(chatId, "Уведомления Smailee отключены. Подключить их снова можно в кабинете.").catch(() => undefined);
  }
  revalidatePath("/app/integrations");
  revalidatePath("/app/integrations/telegram");
  return { ok: "Telegram отключён" };
}
