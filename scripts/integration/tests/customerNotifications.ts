import type { FakeSmtp } from "../fakeSmtp";
import type { FakeBitrix } from "../fakeBitrix";
import { deliverCustomerNotifications, enqueueCustomerReplyNotification } from "@/server/customerNotifications";
import { config } from "@/lib/config";
import { assert, makeCampaign, makeContact, makeMessage, makeUser, prisma, suiteHeader, test } from "../harness";

type TelegramCall = { method: string; body: Record<string, unknown> };

function fakeTelegram() {
  const calls: TelegramCall[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split("/").at(-1) || "";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ method, body });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => { global.fetch = originalFetch; } };
}

async function sourceReply(ownerId: string, createdById: string | null, body: string) {
  const campaign = await makeCampaign(ownerId, { status: "SENT", createdById });
  const contact = await makeContact(ownerId);
  const message = await makeMessage(campaign.id, contact.id, { status: "REPLIED" });
  const reply = await prisma.replyMessage.create({
    data: { messageId: message.id, direction: "inbound", body, status: "SENT" },
  });
  return { campaign, message, reply };
}

export default async function run(smtp: FakeSmtp, _bitrix: FakeBitrix) {
  suiteHeader("customer notifications — маршрутизация, группировка, дедупликация");

  await test("пустое окно не отправляет ни Telegram, ни email-дайджест", async () => {
    smtp.reset();
    const tg = fakeTelegram();
    try {
      const result = await deliverCustomerNotifications(new Date("2026-08-17T10:00:00.000Z"));
      assert.deepEqual(result, {
        checked: 0,
        sent: 0,
        failed: 0,
        telegram: { checked: 0, sent: 0, failed: 0 },
        email: { checked: 0, sent: 0, failed: 0 },
      });
      assert.equal(tg.calls.length, 0, "Telegram API не вызывается без событий");
      assert.equal(smtp.received.length, 0, "пустое письмо не создаётся");
    } finally {
      tg.restore();
    }
  });

  await test("переход в HOT создаёт только тёплый лид, не обычный ответ", async () => {
    const owner = await makeUser({
      telegramChatId: "8101",
      telegramConnectedAt: new Date(),
      customerNotificationScope: "OWN",
      telegramWarmLeadMode: "IMMEDIATE",
      telegramReplyMode: "IMMEDIATE",
    });
    const { reply } = await sourceReply(owner.id, owner.id, "Давайте обсудим внедрение");
    const now = new Date("2026-08-17T10:00:00.000Z");

    await enqueueCustomerReplyNotification({
      ownerId: owner.id,
      campaignCreatedById: owner.id,
      sourceReplyId: reply.id,
      previousQualification: "COLD",
      currentQualification: "HOT",
      actionRequired: true,
      now,
    });
    // Повтор постановки того же входящего имитирует безопасный retry.
    await enqueueCustomerReplyNotification({
      ownerId: owner.id,
      campaignCreatedById: owner.id,
      sourceReplyId: reply.id,
      previousQualification: "COLD",
      currentQualification: "HOT",
      actionRequired: true,
      now,
    });

    const queued = await prisma.customerNotificationDelivery.findMany();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].category, "WARM_LEAD");

    const tg = fakeTelegram();
    try {
      await deliverCustomerNotifications(new Date(now.getTime() + 1));
      const sends = tg.calls.filter((call) => call.method === "sendMessage");
      assert.equal(sends.length, 1);
      assert.match(String(sends[0].body.text), /Тёплые лиды/);
      assert.doesNotMatch(String(sends[0].body.text), /Новые ответы/);
    } finally {
      tg.restore();
    }
  });

  await test("Telegram группирует ответы и тёплые лиды двумя сообщениями", async () => {
    const owner = await makeUser({
      telegramChatId: "8201",
      telegramConnectedAt: new Date(),
      customerNotificationScope: "OWN",
      telegramWarmLeadMode: "GROUPED",
      telegramReplyMode: "GROUPED",
      telegramGroupMinutes: 5,
    });
    const ordinary = await sourceReply(owner.id, owner.id, "Пришлите подробности");
    const warm = await sourceReply(owner.id, owner.id, "Готовы созвониться");
    const now = new Date("2026-08-17T10:02:00.000Z");

    await enqueueCustomerReplyNotification({
      ownerId: owner.id,
      campaignCreatedById: owner.id,
      sourceReplyId: ordinary.reply.id,
      previousQualification: "UNKNOWN",
      currentQualification: "COLD",
      actionRequired: true,
      now,
    });
    await enqueueCustomerReplyNotification({
      ownerId: owner.id,
      campaignCreatedById: owner.id,
      sourceReplyId: warm.reply.id,
      previousQualification: "COLD",
      currentQualification: "HOT",
      actionRequired: true,
      now,
    });

    const tg = fakeTelegram();
    try {
      await deliverCustomerNotifications(new Date("2026-08-17T10:05:01.000Z"));
      const texts = tg.calls.filter((call) => call.method === "sendMessage").map((call) => String(call.body.text));
      assert.equal(texts.length, 2);
      assert.ok(texts.some((text) => text.includes("Новые ответы")));
      assert.ok(texts.some((text) => text.includes("Тёплые лиды")));
      assert.ok(texts.every((text) => !(text.includes("Новые ответы") && text.includes("Тёплые лиды"))));
    } finally {
      tg.restore();
    }
  });

  await test("блокировка бота очищает привязку и отменяет Telegram-очередь", async () => {
    const owner = await makeUser({ telegramChatId: "8251", telegramConnectedAt: new Date() });
    const { reply } = await sourceReply(owner.id, owner.id, "Нужен звонок");
    const now = new Date("2026-08-17T10:10:00.000Z");
    await enqueueCustomerReplyNotification({
      ownerId: owner.id,
      campaignCreatedById: owner.id,
      sourceReplyId: reply.id,
      previousQualification: "COLD",
      currentQualification: "HOT",
      actionRequired: true,
      now,
    });

    const originalFetch = global.fetch;
    global.fetch = (async () => new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
    try {
      await deliverCustomerNotifications(new Date(now.getTime() + 1));
      const updated = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      assert.equal(updated.telegramChatId, null);
      const queued = await prisma.customerNotificationDelivery.findFirstOrThrow();
      assert.ok(queued.canceledAt);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("область ALL не обходит права сотрудника", async () => {
    const owner = await makeUser({ customerNotificationScope: "ALL" });
    const organization = await prisma.organization.create({ data: { name: "Команда", ownerId: owner.id } });
    await prisma.user.update({ where: { id: owner.id }, data: { organizationId: organization.id } });
    const creator = await makeUser({
      organization: { connect: { id: organization.id } },
      organizationRole: "MEMBER",
      organizationPermissions: ["LEADS_REPLY_OWN"],
      customerNotificationScope: "ALL",
      telegramChatId: "8301",
      telegramConnectedAt: new Date(),
    });
    const stranger = await makeUser({
      organization: { connect: { id: organization.id } },
      organizationRole: "MEMBER",
      organizationPermissions: ["LEADS_REPLY_OWN"],
      customerNotificationScope: "ALL",
      telegramChatId: "8302",
      telegramConnectedAt: new Date(),
    });
    const { reply } = await sourceReply(owner.id, creator.id, "Нужен ответ");

    await enqueueCustomerReplyNotification({
      ownerId: owner.id,
      campaignCreatedById: creator.id,
      sourceReplyId: reply.id,
      previousQualification: "UNKNOWN",
      currentQualification: "COLD",
      actionRequired: true,
    });
    const recipients = await prisma.customerNotificationDelivery.findMany({ select: { recipientId: true } });
    assert.ok(recipients.some((row) => row.recipientId === creator.id), "создатель получает свою кампанию");
    assert.ok(!recipients.some((row) => row.recipientId === stranger.id), "ALL без LEADS_REPLY_ALL не расширяет доступ");
  });

  await test("отозванное право отменяет уже ожидающее уведомление", async () => {
    const owner = await makeUser();
    const organization = await prisma.organization.create({ data: { name: "Команда", ownerId: owner.id } });
    await prisma.user.update({ where: { id: owner.id }, data: { organizationId: organization.id } });
    const employee = await makeUser({
      organization: { connect: { id: organization.id } },
      organizationRole: "MEMBER",
      organizationPermissions: ["LEADS_REPLY_ALL"],
      customerNotificationScope: "ALL",
      telegramChatId: "8351",
      telegramConnectedAt: new Date(),
    });
    const { reply } = await sourceReply(owner.id, owner.id, "Проверьте ответ");
    const now = new Date("2026-08-17T10:20:00.000Z");
    await enqueueCustomerReplyNotification({
      ownerId: owner.id,
      campaignCreatedById: owner.id,
      sourceReplyId: reply.id,
      previousQualification: "UNKNOWN",
      currentQualification: "COLD",
      actionRequired: true,
      now,
    });
    await prisma.user.update({ where: { id: employee.id }, data: { organizationPermissions: [] } });

    const tg = fakeTelegram();
    try {
      await deliverCustomerNotifications(new Date(now.getTime() + 1));
      assert.equal(tg.calls.filter((call) => call.method === "sendMessage").length, 0);
      const delivery = await prisma.customerNotificationDelivery.findFirstOrThrow({ where: { recipientId: employee.id } });
      assert.ok(delivery.canceledAt);
    } finally {
      tg.restore();
    }
  });

  await test("email собирает ответы и лиды в один дайджест с двумя секциями", async () => {
    smtp.reset();
    const mail = config.systemMail as unknown as {
      host: string | null; port: number; secure: boolean; user: string | null; password: string | null; from: string | null;
    };
    const previous = { ...mail };
    Object.assign(mail, {
      host: "127.0.0.1",
      port: smtp.port,
      secure: false,
      user: "no-reply@test.local",
      password: "secret",
      from: "Smailee <no-reply@test.local>",
    });
    try {
      const owner = await makeUser({
        emailDigestReplies: true,
        emailDigestWarmLeads: true,
        emailDigestFrequency: "EVERY_15_MINUTES",
        telegramReplyMode: "OFF",
        telegramWarmLeadMode: "OFF",
      });
      const ordinary = await sourceReply(owner.id, owner.id, "Нужен договор");
      const warm = await sourceReply(owner.id, owner.id, "Готовы начать");
      const now = new Date("2026-08-17T11:01:00.000Z");
      await enqueueCustomerReplyNotification({
        ownerId: owner.id,
        campaignCreatedById: owner.id,
        sourceReplyId: ordinary.reply.id,
        previousQualification: "UNKNOWN",
        currentQualification: "COLD",
        actionRequired: true,
        now,
      });
      await enqueueCustomerReplyNotification({
        ownerId: owner.id,
        campaignCreatedById: owner.id,
        sourceReplyId: warm.reply.id,
        previousQualification: "COLD",
        currentQualification: "HOT",
        actionRequired: true,
        now,
      });

      const result = await deliverCustomerNotifications(new Date("2026-08-17T11:15:01.000Z"));
      assert.equal(result.email.sent, 2, "обе записи отмечены доставленными");
      assert.equal(smtp.received.length, 1, "получателю ушло одно письмо, а не два");
      const delivered = await prisma.customerNotificationDelivery.findMany({ where: { channel: "EMAIL" } });
      assert.equal(delivered.filter((item) => item.sentAt).length, 2);
    } finally {
      Object.assign(mail, previous);
    }
  });
}
