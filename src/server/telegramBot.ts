import { config } from "@/lib/config";
import { consumeAuthToken, inspectAuthToken } from "@/lib/authTokens";
import { prisma } from "@/lib/prisma";

export type TelegramUpdate = {
  update_id?: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { username?: string; first_name?: string };
  };
};

export type TelegramBotReply = {
  chatId: string;
  text: string;
  replyMarkup?: Record<string, unknown>;
};

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<TelegramBotReply | null> {
  const message = update.message;
  if (!message?.text || message.chat.type !== "private") return null;

  const chatId = String(message.chat.id);
  const [command, argument] = message.text.trim().split(/\s+/, 2);
  const normalizedCommand = command.split("@")[0].toLowerCase();

  if ((normalizedCommand === "/start" && !argument) || normalizedCommand === "/help") {
    return {
      chatId,
      text: "Я присылаю уведомления о готовых лидах Smailee.\n\nЧтобы подключить кабинет, откройте Smailee → Интеграции → Telegram и нажмите «Подключить Telegram».\n\n/status — проверить подключение\n/stop — отключить уведомления\n/help — помощь",
    };
  }

  if (normalizedCommand === "/start" && argument) {
    const inspected = await inspectAuthToken(argument);
    if (!inspected || inspected.type !== "TELEGRAM_CONNECT") {
      return {
        chatId,
        text: "Ссылка подключения недействительна или устарела. Создайте новую в разделе «Интеграции» кабинета Smailee.",
      };
    }
    const consumed = await consumeAuthToken(argument);
    if (!consumed || consumed.type !== "TELEGRAM_CONNECT") {
      return {
        chatId,
        text: "Эта ссылка уже использована. При необходимости создайте новую в кабинете Smailee.",
      };
    }

    await prisma.$transaction([
      prisma.user.updateMany({
        where: { telegramChatId: chatId, id: { not: consumed.userId } },
        data: { telegramChatId: null, telegramUsername: null, telegramConnectedAt: null },
      }),
      prisma.user.update({
        where: { id: consumed.userId },
        data: {
          telegramChatId: chatId,
          telegramUsername: message.from?.username ?? null,
          telegramConnectedAt: new Date(),
        },
      }),
    ]);
    return {
      chatId,
      text: "✅ <b>Telegram подключён к Smailee</b>\n\nТеперь сюда будут приходить уведомления о готовых лидах. Проверить связь: /status. Отключить: /stop.",
      replyMarkup: {
        inline_keyboard: [[{
          text: "Вернуться в Smailee",
          url: `${config.appUrl.replace(/\/$/, "")}/app/integrations/telegram`,
        }]],
      },
    };
  }

  const linked = await prisma.user.findUnique({ where: { telegramChatId: chatId } });
  if (normalizedCommand === "/stop") {
    if (linked) {
      await prisma.user.update({
        where: { id: linked.id },
        data: { telegramChatId: null, telegramUsername: null, telegramConnectedAt: null },
      });
    }
    return { chatId, text: "Уведомления отключены. Подключить их снова можно в кабинете Smailee." };
  }
  if (normalizedCommand === "/status") {
    return {
      chatId,
      text: linked
        ? "✅ Бот подключён. Уведомления о готовых лидах включены."
        : "Бот не привязан к кабинету. Откройте Smailee → Интеграции → Telegram.",
    };
  }
  return {
    chatId,
    text: "Неизвестная команда. Доступные команды:\n\n/status — проверить подключение\n/stop — отключить уведомления\n/help — помощь",
  };
}
