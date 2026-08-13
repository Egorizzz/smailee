import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { inspectAuthToken, consumeAuthToken } from "@/lib/authTokens";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage, verifyTelegramWebhookSecret } from "@/lib/services/telegram";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { username?: string; first_name?: string };
  };
};

export async function POST(request: NextRequest) {
  if (!config.telegram.botToken) return NextResponse.json({ ok: false }, { status: 503 });
  if (!verifyTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const message = update.message;
  if (!message?.text || message.chat.type !== "private") return NextResponse.json({ ok: true });

  const chatId = String(message.chat.id);
  const [command, argument] = message.text.trim().split(/\s+/, 2);
  const normalizedCommand = command.split("@")[0].toLowerCase();

  if (normalizedCommand === "/start" && argument) {
    const inspected = await inspectAuthToken(argument);
    if (!inspected || inspected.type !== "TELEGRAM_CONNECT") {
      await sendTelegramMessage(chatId, "Ссылка подключения недействительна или устарела. Создайте новую в разделе «Интеграции» кабинета Smailee.");
      return NextResponse.json({ ok: true });
    }
    const consumed = await consumeAuthToken(argument);
    if (!consumed || consumed.type !== "TELEGRAM_CONNECT") {
      await sendTelegramMessage(chatId, "Эта ссылка уже использована. При необходимости создайте новую в кабинете Smailee.");
      return NextResponse.json({ ok: true });
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
    await sendTelegramMessage(
      chatId,
      "✅ <b>Telegram подключён к Smailee</b>\n\nТеперь сюда будут приходить уведомления о готовых лидах. Проверить связь: /status. Отключить: /stop.",
      {
        replyMarkup: {
          inline_keyboard: [[{
            text: "Вернуться в Smailee",
            url: `${config.appUrl.replace(/\/$/, "")}/app/integrations/telegram`,
          }]],
        },
      }
    );
    return NextResponse.json({ ok: true });
  }

  const linked = await prisma.user.findUnique({ where: { telegramChatId: chatId } });
  if (normalizedCommand === "/stop") {
    if (linked) {
      await prisma.user.update({ where: { id: linked.id }, data: { telegramChatId: null, telegramUsername: null, telegramConnectedAt: null } });
    }
    await sendTelegramMessage(chatId, "Уведомления отключены. Подключить их снова можно в кабинете Smailee.");
  } else if (normalizedCommand === "/status") {
    await sendTelegramMessage(chatId, linked ? "✅ Бот подключён. Уведомления о готовых лидах включены." : "Бот не привязан к кабинету. Откройте Smailee → Интеграции → Telegram.");
  } else {
    await sendTelegramMessage(chatId, "Я присылаю уведомления о готовых лидах Smailee.\n\n/status — проверить подключение\n/stop — отключить уведомления\n/help — помощь");
  }
  return NextResponse.json({ ok: true });
}
