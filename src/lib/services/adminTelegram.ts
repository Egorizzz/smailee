import { config } from "@/lib/config";

type TelegramResponse<T> = { ok: true; result: T } | { ok: false; description?: string };

export function adminTelegramBotToken(): string {
  if (!config.adminTelegram.botToken) throw new Error("TELEGRAM_ADMIN_BOT_TOKEN не задан");
  return config.adminTelegram.botToken;
}

export async function callAdminTelegram<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${adminTelegramBotToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json()) as TelegramResponse<T>;
  if (!data.ok) throw new Error(data.description || `Telegram API: HTTP ${response.status}`);
  return data.result;
}

export async function ensureAdminTelegramPolling(): Promise<{ username: string }> {
  const me = await callAdminTelegram<{ username?: string }>("getMe", {});
  if (!me.username) throw new Error("Telegram не вернул username админ-бота");
  await callAdminTelegram<boolean>("deleteWebhook", { drop_pending_updates: false });
  await callAdminTelegram<boolean>("setMyCommands", {
    commands: [
      { command: "start", description: "Подключить служебные уведомления" },
      { command: "status", description: "Проверить доступ" },
      { command: "help", description: "Помощь" },
      { command: "stop", description: "Отключить уведомления" },
    ],
  });
  return { username: me.username };
}

export async function sendAdminTelegramMessage(
  chatId: string,
  text: string,
  options: { replyMarkup?: Record<string, unknown> } = {},
): Promise<void> {
  await callAdminTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export function isPermanentAdminTelegramError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("bot was blocked") || message.includes("chat not found") || message.includes("user is deactivated");
}
