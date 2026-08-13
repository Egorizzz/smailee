import { NextRequest } from "next/server";
import { prisma, assert, makeUser, suiteHeader, test } from "../harness";
import { issueAuthToken } from "@/lib/authTokens";
import { ensureTelegramPolling, telegramWebhookSecret } from "@/lib/services/telegram";
import { notifyOwnerOfHotLead } from "@/server/notifications";
import { POST as telegramWebhook } from "@/app/api/integrations/telegram/webhook/route";
import { pollTelegramBot } from "@/server/telegramPolling";

type TelegramCall = { method: string; body: Record<string, unknown> };

function fakeTelegram(updates: Array<Record<string, unknown>> = []) {
  const calls: TelegramCall[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    const method = path.split("/").at(-1) || "";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ method, body });
    const result = method === "getMe" ? { username: "smailee_test_bot" } : method === "getUpdates" ? updates : true;
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => { global.fetch = originalFetch; } };
}

function updateRequest(chatId: number, text: string, secret = telegramWebhookSecret()) {
  return new NextRequest("https://app.test.local/api/integrations/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify({ message: { text, chat: { id: chatId, type: "private" }, from: { username: "lead_owner" } } }),
  });
}

export default async function run() {
  suiteHeader("telegram — безопасная привязка и уведомления");

  await test("webhook с неверным secret отклоняется", async () => {
    const response = await telegramWebhook(updateRequest(1001, "/status", "wrong-secret"));
    assert.equal(response.status, 401);
  });

  await test("бот сам включает polling и регистрирует команды", async () => {
    const tg = fakeTelegram();
    try {
      const result = await ensureTelegramPolling();
      assert.equal(result.username, "smailee_test_bot");
      assert.deepEqual(tg.calls.map((call) => call.method), ["getMe", "deleteWebhook", "setMyCommands"]);
      const deleteWebhook = tg.calls.find((call) => call.method === "deleteWebhook");
      assert.equal(deleteWebhook?.body.drop_pending_updates, false);
    } finally {
      tg.restore();
    }
  });

  await test("start без ссылки и help отвечают справкой", async () => {
    const start = await telegramWebhook(updateRequest(1501, "/start"));
    const help = await telegramWebhook(updateRequest(1501, "/help"));
    assert.equal(start.status, 200);
    assert.equal(help.status, 200);
    const body = await start.json() as { method?: string; chat_id?: string; text?: string };
    assert.equal(body.method, "sendMessage");
    assert.equal(body.chat_id, "1501");
    assert.match(String(body.text), /Интеграции → Telegram/);
  });

  await test("worker получает status через polling и отвечает в Telegram", async () => {
    const user = await makeUser({ telegramChatId: "1601", telegramConnectedAt: new Date() });
    const tg = fakeTelegram([{
      update_id: 501,
      message: { text: "/status", chat: { id: 1601, type: "private" }, from: { username: "lead_owner" } },
    }]);
    try {
      const processed = await pollTelegramBot();
      assert.equal(processed, 1);
      assert.deepEqual(tg.calls.map((call) => call.method), ["getMe", "deleteWebhook", "setMyCommands", "getUpdates", "sendMessage"]);
      const sent = tg.calls.at(-1);
      assert.equal(sent?.body.chat_id, "1601");
      assert.match(String(sent?.body.text), /Бот подключён/);
      await prisma.user.delete({ where: { id: user.id } });
    } finally {
      tg.restore();
    }
  });

  await test("одноразовая start-ссылка привязывает только один чат", async () => {
    const tg = fakeTelegram();
    try {
      const user = await makeUser();
      const rawToken = await issueAuthToken(user.id, "TELEGRAM_CONNECT", 15 * 60_000);
      const first = await telegramWebhook(updateRequest(2001, `/start ${rawToken}`));
      assert.equal(first.status, 200);

      const linked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(linked.telegramChatId, "2001");
      assert.equal(linked.telegramUsername, "lead_owner");
      assert.ok(linked.telegramConnectedAt);

      const replay = await telegramWebhook(updateRequest(2002, `/start ${rawToken}`));
      const afterReplay = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(afterReplay.telegramChatId, "2001", "повтор ссылки не перехватывает кабинет");
      assert.equal((await first.clone().json()).method, "sendMessage");
      assert.equal((await replay.json()).method, "sendMessage");
    } finally {
      tg.restore();
    }
  });

  await test("готовый лид уходит в Telegram с кнопкой кабинета", async () => {
    const tg = fakeTelegram();
    try {
      const user = await makeUser({ telegramChatId: "3001", telegramConnectedAt: new Date() });
      await notifyOwnerOfHotLead({
        userId: user.id,
        leadId: "lead-test",
        contactEmail: "lead@example.test",
        contactName: "Иван <CEO>",
        summary: "Просит созвониться & обсудить внедрение",
      });
      const sent = tg.calls.find((call) => call.method === "sendMessage");
      assert.ok(sent);
      assert.equal(sent?.body.chat_id, "3001");
      assert.match(String(sent?.body.text), /Иван &lt;CEO&gt;/);
      assert.match(JSON.stringify(sent?.body.reply_markup), /https:\/\/app\.test\.local\/app\/leads#lead-lead-test/);
    } finally {
      tg.restore();
    }
  });

  await test("блокировка бота очищает нерабочую привязку", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
    try {
      const user = await makeUser({ telegramChatId: "4001", telegramConnectedAt: new Date() });
      await notifyOwnerOfHotLead({ userId: user.id, leadId: "lead-test", contactEmail: "lead@example.test" });
      const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(updated.telegramChatId, null);
      assert.equal(updated.telegramConnectedAt, null);
    } finally {
      global.fetch = originalFetch;
    }
  });
}
