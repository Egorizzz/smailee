import { config } from "@/lib/config";
import { callTelegram, ensureTelegramPolling, sendTelegramMessage } from "@/lib/services/telegram";
import { handleTelegramUpdate, type TelegramUpdate } from "./telegramBot";

let offset: number | undefined;
let initialized = false;
let pollInFlight = false;
let pendingDelivery: { updateId?: number; reply: NonNullable<Awaited<ReturnType<typeof handleTelegramUpdate>>> } | null = null;

export async function pollTelegramBot(): Promise<number> {
  if (!config.telegram.botToken || pollInFlight) return 0;
  pollInFlight = true;
  try {
    if (!initialized) {
      await ensureTelegramPolling();
      initialized = true;
      console.log("[worker] Telegram bot: long polling включён, webhook отключён");
    }

    // Если обработка уже изменила БД, но исходящий sendMessage временно упал,
    // повторяем только доставку ответа — не выполняем команду второй раз.
    if (pendingDelivery) {
      await sendTelegramMessage(pendingDelivery.reply.chatId, pendingDelivery.reply.text, {
        replyMarkup: pendingDelivery.reply.replyMarkup,
      });
      if (pendingDelivery.updateId !== undefined) offset = pendingDelivery.updateId + 1;
      pendingDelivery = null;
    }

    const updates = await callTelegram<TelegramUpdate[]>("getUpdates", {
      ...(offset === undefined ? {} : { offset }),
      timeout: 10,
      limit: 20,
      allowed_updates: ["message"],
    });

    for (const update of updates) {
      try {
        const reply = await handleTelegramUpdate(update);
        if (reply) {
          pendingDelivery = { updateId: update.update_id, reply };
          await sendTelegramMessage(reply.chatId, reply.text, { replyMarkup: reply.replyMarkup });
          pendingDelivery = null;
        }
        if (update.update_id !== undefined) offset = update.update_id + 1;
      } catch (error) {
        console.error(`[worker] Telegram update ${update.update_id ?? "unknown"} failed:`, error);
        // Не подтверждаем проблемное событие и не обгоняем его более новыми.
        // Следующий getUpdates безопасно повторит доставку.
        break;
      }
    }
    return updates.length;
  } finally {
    pollInFlight = false;
  }
}

export async function runTelegramPolling(): Promise<never> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const processed = await pollTelegramBot();
      if (processed) console.log(`[worker] Telegram: processed=${processed}`);
    } catch (error) {
      console.error("[worker] Telegram polling failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
