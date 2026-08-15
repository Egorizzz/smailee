import { config } from "@/lib/config";
import { consumeAuthToken, inspectAuthToken } from "@/lib/authTokenStore";
import { prisma } from "@/lib/prisma";

export type AdminTelegramUpdate = {
  update_id?: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { username?: string; first_name?: string; last_name?: string };
  };
};

export type AdminTelegramBotReply = {
  chatId: string;
  text: string;
  replyMarkup?: Record<string, unknown>;
};

const CLOSED_BOT_TEXT =
  "Это закрытый служебный бот Smailee. Доступ выдаётся администратором по одноразовой ссылке из админки.";

export async function handleAdminTelegramUpdate(
  update: AdminTelegramUpdate,
): Promise<AdminTelegramBotReply | null> {
  const message = update.message;
  if (!message?.text || message.chat.type !== "private") return null;

  const chatId = String(message.chat.id);
  const [command, argument] = message.text.trim().split(/\s+/, 2);
  const normalizedCommand = command.split("@")[0].toLowerCase();

  if (normalizedCommand === "/start" && argument) {
    const inspected = await inspectAuthToken(argument);
    if (
      !inspected ||
      inspected.type !== "ADMIN_TELEGRAM_CONNECT" ||
      inspected.user.role !== "ADMIN"
    ) {
      return { chatId, text: `Ссылка недействительна или устарела.\n\n${CLOSED_BOT_TEXT}` };
    }

    const consumed = await consumeAuthToken(argument);
    if (
      !consumed ||
      consumed.type !== "ADMIN_TELEGRAM_CONNECT" ||
      consumed.user.role !== "ADMIN"
    ) {
      return { chatId, text: `Эта ссылка уже использована.\n\n${CLOSED_BOT_TEXT}` };
    }

    const telegramName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || null;
    await prisma.adminTelegramRecipient.upsert({
      where: { chatId },
      create: {
        chatId,
        telegramUsername: message.from?.username ?? null,
        telegramName,
        invitedById: consumed.userId,
      },
      update: {
        telegramUsername: message.from?.username ?? null,
        telegramName,
        invitedById: consumed.userId,
        connectedAt: new Date(),
        revokedAt: null,
      },
    });

    return {
      chatId,
      text: "✅ <b>Служебные уведомления Smailee подключены</b>\n\nСюда будут приходить новые заявки с сайта и запросы на помощь с инфраструктурой.",
      replyMarkup: {
        inline_keyboard: [[{
          text: "Открыть админку",
          url: `${config.appUrl.replace(/\/$/, "")}/app/admin`,
        }]],
      },
    };
  }

  const recipient = await prisma.adminTelegramRecipient.findUnique({ where: { chatId } });
  const hasAccess = Boolean(recipient && !recipient.revokedAt);

  if ((normalizedCommand === "/start" && !argument) || normalizedCommand === "/help") {
    return {
      chatId,
      text: hasAccess
        ? "Служебный бот Smailee подключён.\n\n/status — проверить доступ\n/stop — отключить уведомления\n/help — помощь"
        : CLOSED_BOT_TEXT,
    };
  }

  if (normalizedCommand === "/status") {
    return {
      chatId,
      text: hasAccess
        ? "✅ Доступ активен. Уведомления о новых заявках включены."
        : `Доступ не выдан.\n\n${CLOSED_BOT_TEXT}`,
    };
  }

  if (normalizedCommand === "/stop") {
    if (hasAccess && recipient) {
      await prisma.adminTelegramRecipient.update({
        where: { id: recipient.id },
        data: { revokedAt: new Date() },
      });
    }
    return { chatId, text: "Служебные уведомления отключены. Для повторного подключения нужна новая ссылка из админки." };
  }

  return {
    chatId,
    text: hasAccess
      ? "Неизвестная команда. Используйте /status, /stop или /help."
      : CLOSED_BOT_TEXT,
  };
}
