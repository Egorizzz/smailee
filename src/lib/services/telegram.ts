import crypto from "node:crypto";
import { config } from "@/lib/config";

type TelegramResponse<T> = { ok: true; result: T } | { ok: false; description?: string };

function token(): string {
  if (!config.telegram.botToken) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  return config.telegram.botToken;
}

async function callTelegram<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json()) as TelegramResponse<T>;
  if (!data.ok) throw new Error(data.description || `Telegram API: HTTP ${response.status}`);
  return data.result;
}

export function telegramWebhookSecret(): string {
  return crypto.createHash("sha256").update(`smailee-telegram:${token()}`).digest("base64url");
}

export function verifyTelegramWebhookSecret(value: string | null): boolean {
  if (!value || !config.telegram.botToken) return false;
  const expected = telegramWebhookSecret();
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function ensureTelegramWebhook(): Promise<{ username: string }> {
  const me = await callTelegram<{ username?: string }>("getMe", {});
  if (!me.username) throw new Error("Telegram не вернул username бота");
  const appUrl = config.appUrl.replace(/\/$/, "");
  if (!appUrl.startsWith("https://")) {
    throw new Error("Для Telegram webhook задайте публичный HTTPS APP_URL");
  }
  await callTelegram<boolean>("setWebhook", {
    url: `${appUrl}/api/integrations/telegram/webhook`,
    secret_token: telegramWebhookSecret(),
    allowed_updates: ["message"],
  });
  await callTelegram<boolean>("setMyCommands", {
    commands: [
      { command: "start", description: "Подключить кабинет Smailee" },
      { command: "status", description: "Проверить подключение" },
      { command: "help", description: "Как работает бот" },
      { command: "stop", description: "Отключить уведомления" },
    ],
  });
  return { username: me.username };
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options: { replyMarkup?: Record<string, unknown> } = {}
): Promise<void> {
  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export function escapeTelegramHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
