import { NextRequest } from "next/server";
import { prisma, assert, makeUser, suiteHeader, test } from "../harness";
import { issueAuthToken } from "@/lib/authTokens";
import { ensureTelegramWebhook, telegramWebhookSecret } from "@/lib/services/telegram";
import { notifyOwnerOfHotLead } from "@/server/notifications";
import { POST as telegramWebhook } from "@/app/api/integrations/telegram/webhook/route";

type TelegramCall = { method: string; body: Record<string, unknown> };

function fakeTelegram() {
  const calls: TelegramCall[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    const method = path.split("/").at(-1) || "";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ method, body });
    return new Response(JSON.stringify({ ok: true, result: method === "getMe" ? { username: "smailee_test_bot" } : true }), {
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

  await test("бот сам регистрирует webhook и команды", async () => {
    const tg = fakeTelegram();
    try {
      const result = await ensureTelegramWebhook();
      assert.equal(result.username, "smailee_test_bot");
      assert.deepEqual(tg.calls.map((call) => call.method), ["getMe", "setWebhook", "setMyCommands"]);
      const webhook = tg.calls.find((call) => call.method === "setWebhook");
      assert.equal(webhook?.body.url, "https://app.test.local/api/integrations/telegram/webhook");
      assert.equal(webhook?.body.secret_token, telegramWebhookSecret());
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

      await telegramWebhook(updateRequest(2002, `/start ${rawToken}`));
      const afterReplay = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(afterReplay.telegramChatId, "2001", "повтор ссылки не перехватывает кабинет");
      assert.equal(tg.calls.filter((call) => call.method === "sendMessage").length, 2);
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
