import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { verifyTelegramWebhookSecret } from "@/lib/services/telegram";
import { handleTelegramUpdate, type TelegramUpdate } from "@/server/telegramBot";

function reply(
  chatId: string,
  text: string,
  options: { replyMarkup?: Record<string, unknown> } = {}
) {
  // Telegram умеет выполнить Bot API-метод прямо из успешного ответа webhook.
  // Так обработчик не ждёт отдельный исходящий запрос к api.telegram.org.
  return NextResponse.json({
    method: "sendMessage",
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export async function POST(request: NextRequest) {
  if (!config.telegram.botToken) return NextResponse.json({ ok: false }, { status: 503 });
  if (!verifyTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const botReply = await handleTelegramUpdate((await request.json()) as TelegramUpdate);
  return botReply
    ? reply(botReply.chatId, botReply.text, { replyMarkup: botReply.replyMarkup })
    : NextResponse.json({ ok: true });
}
