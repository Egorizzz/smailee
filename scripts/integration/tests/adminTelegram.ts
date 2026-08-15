import { prisma, assert, makeUser, suiteHeader, test } from "../harness";
import { issueAuthToken } from "@/lib/authTokens";
import { handleAdminTelegramUpdate } from "@/server/adminTelegramBot";
import {
  deliverAdminTelegramNotifications,
  queueLandingLeadTelegramNotification,
} from "@/server/adminTelegramNotifications";

type TelegramCall = { method: string; body: Record<string, unknown> };

function update(chatId: number, text: string) {
  return {
    update_id: chatId,
    message: {
      text,
      chat: { id: chatId, type: "private" },
      from: { username: `admin_${chatId}`, first_name: "Админ" },
    },
  };
}

function fakeTelegram(error?: string) {
  const calls: TelegramCall[] = [];
  const sender = async (chatId: string, text: string, options: { replyMarkup?: Record<string, unknown> } = {}) => {
    calls.push({ method: "sendMessage", body: { chat_id: chatId, text, reply_markup: options.replyMarkup } });
    if (error) throw new Error(error);
  };
  return { calls, sender };
}

export default async function run() {
  suiteHeader("admin Telegram — закрытый доступ и надёжная доставка заявок");

  await test("клиентский аккаунт не может выдать доступ к служебному боту", async () => {
    const client = await makeUser({ role: "CLIENT" });
    const token = await issueAuthToken(client.id, "ADMIN_TELEGRAM_CONNECT");
    const reply = await handleAdminTelegramUpdate(update(7101, `/start ${token}`));
    assert.match(reply?.text || "", /недействительна/i);
    assert.equal(await prisma.adminTelegramRecipient.count(), 0);
  });

  await test("одноразовая ссылка администратора подключает только личный чат", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const token = await issueAuthToken(admin.id, "ADMIN_TELEGRAM_CONNECT");
    const reply = await handleAdminTelegramUpdate(update(7201, `/start ${token}`));
    assert.match(reply?.text || "", /подключены/i);
    const recipient = await prisma.adminTelegramRecipient.findUniqueOrThrow({ where: { chatId: "7201" } });
    assert.equal(recipient.invitedById, admin.id);
    assert.equal(recipient.revokedAt, null);

    const replay = await handleAdminTelegramUpdate(update(7202, `/start ${token}`));
    assert.match(replay?.text || "", /(использована|недействительна)/i);
    assert.equal(await prisma.adminTelegramRecipient.count(), 1);
  });

  await test("заявка доставляется всем активным получателям и не уходит отозванным", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await prisma.adminTelegramRecipient.createMany({ data: [
      { chatId: "7301", invitedById: admin.id },
      { chatId: "7302", invitedById: admin.id, revokedAt: new Date() },
    ] });
    const queued = await queueLandingLeadTelegramNotification({
      id: "landing-1",
      name: "Иван <CEO>",
      email: "ivan@example.test",
      messenger: "@ivan",
      company: "Ромашка & Ко",
      source: "site",
    });
    assert.equal(queued, 1);

    const telegram = fakeTelegram();
    const result = await deliverAdminTelegramNotifications(new Date(), telegram.sender);
    assert.equal(result.sent, 1);
    const sent = telegram.calls.find((call) => call.method === "sendMessage");
    assert.equal(sent?.body.chat_id, "7301");
    assert.match(String(sent?.body.text), /Иван &lt;CEO&gt;/);
    assert.match(JSON.stringify(sent?.body.reply_markup), /landing-lead-landing-1/);
    assert.equal(telegram.calls.some((call) => call.body.chat_id === "7302"), false);
  });

  await test("блокировка бота отзывает получателя и прекращает ретраи", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const recipient = await prisma.adminTelegramRecipient.create({
      data: { chatId: "7401", invitedById: admin.id },
    });
    await queueLandingLeadTelegramNotification({
      id: "landing-2",
      name: "Анна",
      email: "anna@example.test",
      messenger: null,
      company: null,
      source: null,
    });

    const telegram = fakeTelegram("Forbidden: bot was blocked by the user");
    const result = await deliverAdminTelegramNotifications(new Date(), telegram.sender);
    assert.equal(result.revoked, 1);
    const updated = await prisma.adminTelegramRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
    assert.ok(updated.revokedAt);
    const delivery = await prisma.adminTelegramDelivery.findFirstOrThrow({ where: { recipientId: recipient.id } });
    assert.ok(delivery.discardedAt);
  });
}
