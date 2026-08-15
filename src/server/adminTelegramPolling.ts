import { config } from "@/lib/config";
import {
  callAdminTelegram,
  ensureAdminTelegramPolling,
  sendAdminTelegramMessage,
} from "@/lib/services/adminTelegram";
import { handleAdminTelegramUpdate, type AdminTelegramUpdate } from "./adminTelegramBot";

let offset: number | undefined;
let initialized = false;
let pollInFlight = false;
let pendingDelivery: {
  updateId?: number;
  reply: NonNullable<Awaited<ReturnType<typeof handleAdminTelegramUpdate>>>;
} | null = null;

export async function pollAdminTelegramBot(): Promise<number> {
  if (!config.adminTelegram.botToken || pollInFlight) return 0;
  pollInFlight = true;
  try {
    if (!initialized) {
      await ensureAdminTelegramPolling();
      initialized = true;
      console.log("[worker] Admin Telegram bot: long polling включён, webhook отключён");
    }

    if (pendingDelivery) {
      await sendAdminTelegramMessage(pendingDelivery.reply.chatId, pendingDelivery.reply.text, {
        replyMarkup: pendingDelivery.reply.replyMarkup,
      });
      if (pendingDelivery.updateId !== undefined) offset = pendingDelivery.updateId + 1;
      pendingDelivery = null;
    }

    const updates = await callAdminTelegram<AdminTelegramUpdate[]>("getUpdates", {
      ...(offset === undefined ? {} : { offset }),
      timeout: 10,
      limit: 20,
      allowed_updates: ["message"],
    });

    for (const update of updates) {
      try {
        const reply = await handleAdminTelegramUpdate(update);
        if (reply) {
          pendingDelivery = { updateId: update.update_id, reply };
          await sendAdminTelegramMessage(reply.chatId, reply.text, { replyMarkup: reply.replyMarkup });
          pendingDelivery = null;
        }
        if (update.update_id !== undefined) offset = update.update_id + 1;
      } catch (error) {
        console.error(`[worker] Admin Telegram update ${update.update_id ?? "unknown"} failed:`, error);
        break;
      }
    }
    return updates.length;
  } finally {
    pollInFlight = false;
  }
}

export async function runAdminTelegramPolling(): Promise<never> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const processed = await pollAdminTelegramBot();
      if (processed) console.log(`[worker] Admin Telegram: processed=${processed}`);
    } catch (error) {
      console.error("[worker] Admin Telegram polling failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
