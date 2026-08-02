import {
  approveAndSendReply,
  handleInboundReply,
  matchIncomingToMessage,
  nextImapPosition,
  pushLeadToCrm,
} from "@/server/inboundEngine";
import { embedWarmupMarker, extractWarmupCode } from "@/lib/mail/warmupDetector";
import type { FetchedEmail } from "@/lib/mail/imap";
import type { FakeSmtp } from "../fakeSmtp";
import type { FakeBitrix } from "../fakeBitrix";
import { encryptSecret } from "@/lib/crypto";
import { pushLead, verifyBitrixWebhook } from "@/lib/services/bitrix";
import {
  assert,
  daysAgo,
  makeCampaign,
  makeContact,
  makeDomain,
  makeMailbox,
  makeMessage,
  makeUser,
  prisma,
  suiteHeader,
  test,
} from "../harness";

/**
 * Приём ответов и ИИ-диалог (§5.4, §5.5).
 *
 * Что здесь НЕ покрыто и почему: сам цикл pollInboundMailboxes ходит в IMAP
 * через imapflow, а поднять фейковый IMAP-сервер несопоставимо дороже, чем
 * SMTP. Поэтому проверяется всё, что вокруг него: привязка входящего к
 * исходному письму, позиция поллинга (чистая функция), обработка ответа,
 * модерация и квалификация. Ветка «письмо прогрева не создаёт диалог» здесь
 * закрыта только со стороны детектора маркера.
 *
 * ИИ работает в mock-режиме: run.ts снимает DEEPSEEK_API_KEY, адаптер отдаёт
 * детерминированные ответы без сети (см. src/lib/services/deepseek.ts).
 */

function inbound(data: Partial<FetchedEmail> = {}): FetchedEmail {
  return {
    uid: 1,
    messageId: "<incoming@example.test>",
    inReplyTo: null,
    references: [],
    fromEmail: "lead@example.test",
    fromName: "Лид",
    subject: "Re: Тема",
    text: "Спасибо, интересно.",
    html: null,
    date: new Date(),
    ...data,
  };
}

/** Клиент с ящиком, кампанией и одним отправленным письмом — основа диалога. */
async function makeConversation(smtpPort: number, opts: { moderation?: boolean } = {}) {
  const user = await makeUser({ aiModerationEnabled: opts.moderation ?? false });
  const domain = await makeDomain(user.id);
  const mailbox = await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort });
  const campaign = await makeCampaign(user.id, { status: "SENT" });
  const contact = await makeContact(user.id, { email: "lead@example.test" });
  const message = await makeMessage(campaign.id, contact.id, {
    status: "SENT",
    sentAt: daysAgo(1),
    mailboxId: mailbox.id,
    messageIdHeader: "<outgoing-1@smailee>",
  });
  return { user, mailbox, campaign, contact, message };
}

export default async function run(smtp: FakeSmtp, bitrix: FakeBitrix) {
  suiteHeader("inboundEngine — привязка ответов, ИИ-диалог, квалификация");

  await test("входящее привязывается по In-Reply-To", async () => {
    const { user, message } = await makeConversation(smtp.port);

    const found = await matchIncomingToMessage(
      user.id,
      inbound({ inReplyTo: "<outgoing-1@smailee>" })
    );

    assert.equal(found?.id, message.id);
  });

  await test("если In-Reply-To не совпал, ищем по References", async () => {
    const { user, message } = await makeConversation(smtp.port);

    const found = await matchIncomingToMessage(
      user.id,
      inbound({
        inReplyTo: "<unknown@elsewhere>",
        references: ["<older@thing>", "<outgoing-1@smailee>"],
      })
    );

    assert.equal(found?.id, message.id, "цепочка References — второй по приоритету признак");
  });

  await test("без заголовков треда работает фолбэк по адресу отправителя", async () => {
    const { user, message } = await makeConversation(smtp.port);

    const found = await matchIncomingToMessage(user.id, inbound({ messageId: null }));

    assert.equal(found?.id, message.id, "берётся последнее письмо этому контакту");
  });

  await test("письмо не привязывается к переписке ЧУЖОГО клиента", async () => {
    const { message } = await makeConversation(smtp.port);
    const stranger = await makeUser();

    const found = await matchIncomingToMessage(
      stranger.id,
      inbound({ inReplyTo: "<outgoing-1@smailee>" })
    );

    assert.equal(found, null, "изоляция аккаунтов: чужой тред недоступен даже по точному Message-ID");
    assert.ok(message.id);
  });

  await test("неизвестный отправитель ни к чему не привязывается", async () => {
    const { user } = await makeConversation(smtp.port);

    const found = await matchIncomingToMessage(
      user.id,
      inbound({ fromEmail: "stranger@nowhere.test", messageId: null })
    );

    assert.equal(found, null);
  });

  await test("ответ клиента сохраняется в тред и переводит письмо в REPLIED", async () => {
    smtp.reset();
    const { message } = await makeConversation(smtp.port);

    await handleInboundReply({
      messageId: message.id,
      inboundBody: "Спасибо, не актуально.",
      externalMessageId: "<in-1@example.test>",
    });

    const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    assert.equal(after.status, "REPLIED");
    assert.ok(after.repliedAt);
    const incoming = await prisma.replyMessage.findFirstOrThrow({
      where: { messageId: message.id, direction: "inbound" },
    });
    assert.equal(incoming.body, "Спасибо, не актуально.");
    const event = await prisma.event.findFirstOrThrow({ where: { messageId: message.id } });
    assert.equal(event.type, "reply");
  });

  await test("то же самое письмо не обрабатывается дважды", async () => {
    smtp.reset();
    const { message } = await makeConversation(smtp.port);
    const input = {
      messageId: message.id,
      inboundBody: "Сколько стоит?",
      externalMessageId: "<in-dup@example.test>",
    };

    const first = await handleInboundReply(input);
    const second = await handleInboundReply(input);

    assert.equal(first.alreadyProcessed, false);
    assert.equal(second.alreadyProcessed, true, "рестарт воркера между fetch и записью UID — штатная ситуация");
    const inboundCount = await prisma.replyMessage.count({
      where: { messageId: message.id, direction: "inbound" },
    });
    assert.equal(inboundCount, 1, "дубля входящего нет");
    assert.equal(smtp.received.length, 1, "и второй ответ клиенту не улетел");
  });

  await test("при включённой модерации ответ ИИ остаётся черновиком", async () => {
    smtp.reset();
    const { message } = await makeConversation(smtp.port, { moderation: true });

    const res = await handleInboundReply({
      messageId: message.id,
      inboundBody: "Сколько стоит?",
      externalMessageId: "<in-mod@example.test>",
    });

    assert.equal(res.moderated, true);
    const draft = await prisma.replyMessage.findFirstOrThrow({
      where: { messageId: message.id, direction: "outbound" },
    });
    assert.equal(draft.status, "DRAFT");
    assert.equal(smtp.received.length, 0, "без одобрения оператора клиенту ничего не уходит");
  });

  await test("без модерации ответ уходит с того же ящика и держит тред", async () => {
    smtp.reset();
    const { message, mailbox } = await makeConversation(smtp.port);

    await handleInboundReply({
      messageId: message.id,
      inboundBody: "Сколько стоит?",
      externalMessageId: "<in-auto@example.test>",
    });

    assert.equal(smtp.received.length, 1);
    assert.equal(smtp.received[0].from, mailbox.email, "переписку продолжает тот же ящик");
    const raw = smtp.received[0].data;
    assert.ok(raw.includes("In-Reply-To: <in-auto@example.test>"), "ответ ссылается на входящее");
    assert.ok(raw.includes("References:"), "цепочка треда проставлена");
    const sent = await prisma.replyMessage.findFirstOrThrow({
      where: { messageId: message.id, direction: "outbound" },
    });
    assert.equal(sent.status, "SENT");
    assert.ok(sent.providerMessageId);
  });

  await test("заинтересованный ответ создаёт тёплого лида", async () => {
    smtp.reset();
    const { message, user } = await makeConversation(smtp.port);

    const res = await handleInboundReply({
      messageId: message.id,
      inboundBody: "Интересно, сколько стоит внедрение?",
      externalMessageId: "<in-hot@example.test>",
    });

    assert.equal(res.qualification, "HOT");
    const lead = await prisma.lead.findUniqueOrThrow({ where: { messageId: message.id } });
    assert.equal(lead.qualification, "HOT");
    assert.equal(lead.userId, user.id);
    // pushedToCrm тут НЕ проверяем: у этого клиента Битрикс не подключён.
    // Раньше тест ждал true, потому что mock-адаптер возвращал успех без
    // единого запроса — и закреплял ровно ту ложь, из-за которой интерфейс
    // показывал «передан в CRM» при отсутствующей интеграции.
    // Реальная передача проверяется отдельными тестами ниже.
  });

  await test("отказ создаёт холодного лида и в CRM не уходит", async () => {
    smtp.reset();
    const { message } = await makeConversation(smtp.port);

    const res = await handleInboundReply({
      messageId: message.id,
      inboundBody: "Нам это не нужно, спасибо.",
      externalMessageId: "<in-cold@example.test>",
    });

    assert.equal(res.qualification, "COLD");
    const lead = await prisma.lead.findUniqueOrThrow({ where: { messageId: message.id } });
    assert.equal(lead.qualification, "COLD");
    assert.equal(lead.pushedToCrm, false);
  });

  await test("если ящик отправки неизвестен, ответ остаётся черновиком", async () => {
    smtp.reset();
    const user = await makeUser({ aiModerationEnabled: false });
    const campaign = await makeCampaign(user.id, { status: "SENT" });
    const contact = await makeContact(user.id);
    // письмо без mailboxId (например, симуляция ответа на несозданной рассылке)
    const message = await makeMessage(campaign.id, contact.id, { status: "SENT" });

    const res = await handleInboundReply({
      messageId: message.id,
      inboundBody: "Сколько стоит?",
      externalMessageId: "<in-nobox@example.test>",
    });

    assert.equal(res.moderated, true, "отправить неоткуда — черновик виден оператору");
    assert.equal(smtp.received.length, 0);
  });

  await test("одобренный черновик уходит клиенту, повторное одобрение — нет", async () => {
    smtp.reset();
    const { message } = await makeConversation(smtp.port, { moderation: true });
    await handleInboundReply({
      messageId: message.id,
      inboundBody: "Сколько стоит?",
      externalMessageId: "<in-approve@example.test>",
    });
    const draft = await prisma.replyMessage.findFirstOrThrow({
      where: { messageId: message.id, direction: "outbound" },
    });

    const first = await approveAndSendReply(draft.id);
    const second = await approveAndSendReply(draft.id);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(smtp.received.length, 1, "двойной клик оператора не шлёт письмо дважды");
    const after = await prisma.replyMessage.findUniqueOrThrow({ where: { id: draft.id } });
    assert.equal(after.status, "SENT");
  });

  await test("первый опрос ящика не поднимает старую переписку", async () => {
    // reset = первый опрос или сменилась UIDVALIDITY: только baseline.
    // Ошибка здесь = ИИ отвечает на всю историю ящика разом.
    const pos = nextImapPosition({ reset: true, uidNext: 5000, emails: [], currentLastUid: 0 });
    assert.equal(pos, 4999, "позиция ставится на текущий конец ящика");
  });

  await test("пустой опрос не сдвигает позицию, непустой — двигает на максимальный UID", async () => {
    const idle = nextImapPosition({ reset: false, uidNext: 120, emails: [], currentLastUid: 118 });
    assert.equal(idle, 118);

    const moved = nextImapPosition({
      reset: false,
      uidNext: 125,
      emails: [{ uid: 121 }, { uid: 124 }, { uid: 122 }],
      currentLastUid: 118,
    });
    assert.equal(moved, 124, "порядок писем в выдаче не гарантирован — берётся максимум");
  });

  await test("вебхук: мусор и http отклоняются до обращения к сети", async () => {
    // http запрещён намеренно: вебхук — пароль от CRM, по открытому протоколу
    // он утечёт по дороге. Форма проверяется до вызова, чтобы клиент увидел
    // внятное объяснение, а не «Битрикс ответил не-JSON».
    for (const bad of [
      "просто текст",
      "https://портал.bitrix24.ru/",
      "http://портал.bitrix24.ru/rest/1/токен/",
    ]) {
      const res = await verifyBitrixWebhook(bad);
      assert.equal(res.ok, false, `должно быть отклонено: ${bad}`);
    }
  });

  await test("вебхук: рабочая ссылка проходит проверку", async () => {
    // фейковый портал поднят на http, поэтому проверяем сам сетевой путь
    // напрямую через pushLead — форма ссылки уже проверена тестом выше
    bitrix.reset();
    const res = await pushLead(bitrix.webhookUrl, {
      title: "Проверка связи",
      email: "check@example.test",
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.ok(res.crmId, "портал вернул id созданного лида");
  });

  await test("тёплый лид реально уезжает в Битрикс и закрывает линию", async () => {
    smtp.reset();
    bitrix.reset();
    const { message, user, mailbox } = await makeConversation(smtp.port);
    await prisma.user.update({
      where: { id: user.id },
      data: { bitrixWebhookEnc: encryptSecret(bitrix.webhookUrl) },
    });

    // текст подобран под mock-паттерн call_request (mockQualifyLead в
    // deepseek.ts) — теста через триггер, а не через общую оценку "тёплый"
    await handleInboundReply({
      messageId: message.id,
      inboundBody: "Интересно! Давайте созвонимся на этой неделе?",
      externalMessageId: "<in-crm-ok@example.test>",
    });

    assert.equal(bitrix.leads.length, 1, "портал получил ровно одного лида");
    const sent = bitrix.leads[0];
    assert.equal(sent.email, "lead@example.test");
    assert.ok(sent.comments.includes("Переписка:"), "переписка приложена");
    assert.ok(
      sent.comments.includes(mailbox.email),
      "указан адрес, с которого вёлся диалог — продавцу отвечать с него"
    );

    const lead = await prisma.lead.findUniqueOrThrow({ where: { messageId: message.id } });
    assert.equal(lead.pushedToCrm, true);
    assert.ok(lead.crmEntityId, "id лида в Битриксе сохранён — иначе связь с CRM теряется");
    assert.ok(lead.handedOffAt, "линия закрыта");
  });

  await test("ошибка портала не закрывает линию — ИИ продолжает вести клиента", async () => {
    smtp.reset();
    bitrix.reset();
    bitrix.failNext = true;
    try {
      const { message, user } = await makeConversation(smtp.port);
      await prisma.user.update({
        where: { id: user.id },
        data: { bitrixWebhookEnc: encryptSecret(bitrix.webhookUrl) },
      });

      await handleInboundReply({
        messageId: message.id,
        inboundBody: "Интересно, сколько стоит внедрение?",
        externalMessageId: "<in-crm-fail@example.test>",
      });

      const lead = await prisma.lead.findUniqueOrThrow({ where: { messageId: message.id } });
      // Если бы линия закрылась при неудаче, клиент остался бы без ответа
      // вообще: ИИ замолчал, а лида в CRM нет и продавец о нём не знает.
      assert.equal(lead.pushedToCrm, false);
      assert.equal(lead.handedOffAt, null, "линия осталась открытой");
    } finally {
      bitrix.failNext = false;
    }
  });

  await test("после передачи в CRM ИИ перестаёт отвечать клиенту", async () => {
    smtp.reset();
    const { message, user } = await makeConversation(smtp.port);
    // лид уже отдан живому продавцу
    await prisma.lead.create({
      data: {
        userId: user.id,
        messageId: message.id,
        qualification: "HOT",
        summary: "Просил позвонить",
        pushedToCrm: true,
        crmEntityId: "42",
        handedOffAt: new Date(),
        handoffTrigger: "call_request",
      },
    });

    const res = await handleInboundReply({
      messageId: message.id,
      inboundBody: "А ещё вопрос: какие сроки внедрения?",
      externalMessageId: "<in-after-handoff@example.test>",
    });

    assert.equal(res.handedOff, true, "обработчик сообщает, что линия закрыта");
    assert.equal(res.replyBody, null, "ответ ИИ не сгенерирован");
    assert.equal(smtp.received.length, 0, "клиенту ничего не ушло — иначе бот спорил бы с продавцом");

    // входящее при этом НЕ теряется: продавец должен видеть его в треде
    const inbound = await prisma.replyMessage.findFirstOrThrow({
      where: { messageId: message.id, direction: "inbound" },
    });
    assert.ok(inbound.body.includes("сроки внедрения"), "письмо клиента зафиксировано в переписке");
    const outbound = await prisma.replyMessage.count({
      where: { messageId: message.id, direction: "outbound" },
    });
    assert.equal(outbound, 0, "черновик ответа тоже не создаётся");
  });

  await test("без подключённого Битрикса лид не помечается переданным", async () => {
    smtp.reset();
    // bitrixWebhookEnc не задан — передавать некуда. Раньше mock-режим
    // возвращал успех, и лид помечался pushedToCrm=true, хотя не уходил никуда:
    // интерфейс показывал «передан в CRM», а лида там не было.
    const { message } = await makeConversation(smtp.port);

    await handleInboundReply({
      messageId: message.id,
      inboundBody: "Интересно, сколько стоит внедрение?",
      externalMessageId: "<in-nocrm@example.test>",
    });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { messageId: message.id } });
    assert.equal(lead.qualification, "HOT");
    assert.equal(lead.pushedToCrm, false, "не врём, что передали");
    assert.equal(lead.handedOffAt, null, "и линию не закрываем — иначе клиент остался бы без ответа");
  });

  await test("линия закрывается только после подтверждённой передачи", async () => {
    smtp.reset();
    // Ключевой инвариант: handedOffAt и pushedToCrm ставятся ВМЕСТЕ и только
    // при успехе. Если бы линия закрывалась до подтверждения, при недоступном
    // портале ИИ бы замолчал, а лида в CRM не появилось — клиент в вакууме.
    const { message } = await makeConversation(smtp.port);
    await handleInboundReply({
      messageId: message.id,
      inboundBody: "Давайте созвонимся на следующей неделе",
      externalMessageId: "<in-confirm@example.test>",
    });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { messageId: message.id } });
    assert.equal(
      lead.pushedToCrm,
      Boolean(lead.handedOffAt),
      "переданность и закрытие линии не расходятся"
    );
  });

  await test("ручная передача уезжает в Битрикс и закрывает линию, минуя триггеры", async () => {
    smtp.reset();
    bitrix.reset();
    const { message, user, mailbox } = await makeConversation(smtp.port);
    await prisma.user.update({
      where: { id: user.id },
      data: { bitrixWebhookEnc: encryptSecret(bitrix.webhookUrl) },
    });
    // отказ клиента — ИИ ни один встроенный триггер не нашёл бы
    await handleInboundReply({
      messageId: message.id,
      inboundBody: "Спасибо, пока неактуально",
      externalMessageId: "<in-manual@example.test>",
    });
    const before = await prisma.lead.findUniqueOrThrow({ where: { messageId: message.id } });
    assert.equal(before.pushedToCrm, false, "автоматически передан не был");

    const res = await pushLeadToCrm(before.id, user.id);

    assert.equal(res.ok, true);
    assert.equal(bitrix.leads.length, 1);
    assert.ok(bitrix.leads[0].comments.includes(mailbox.email));
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(after.pushedToCrm, true);
    assert.equal(after.handoffTrigger, "manual");
    assert.ok(after.handedOffAt, "линия закрыта так же, как при автопередаче");
  });

  await test("ручная передача: повторный клик и лид другого клиента отклоняются", async () => {
    smtp.reset();
    bitrix.reset();
    const { message, user } = await makeConversation(smtp.port);
    await prisma.user.update({
      where: { id: user.id },
      data: { bitrixWebhookEnc: encryptSecret(bitrix.webhookUrl) },
    });
    await handleInboundReply({
      messageId: message.id,
      inboundBody: "Спасибо, подумаю",
      externalMessageId: "<in-manual-dup@example.test>",
    });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { messageId: message.id } });

    const first = await pushLeadToCrm(lead.id, user.id);
    assert.equal(first.ok, true);
    const second = await pushLeadToCrm(lead.id, user.id);
    assert.equal(second.ok, false, "второй клик не создаёт дубль в Битриксе");
    assert.equal(bitrix.leads.length, 1);

    // чужой аккаунт не может передать лид не своего клиента
    const stranger = await makeUser();
    const stolen = await pushLeadToCrm(lead.id, stranger.id);
    assert.equal(stolen.ok, false);
  });

  await test("ручная передача без подключённого Битрикса — понятная ошибка", async () => {
    smtp.reset();
    const { message, user } = await makeConversation(smtp.port);
    await handleInboundReply({
      messageId: message.id,
      inboundBody: "Спасибо, не сейчас",
      externalMessageId: "<in-manual-nocrm@example.test>",
    });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { messageId: message.id } });

    const res = await pushLeadToCrm(lead.id, user.id);
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("не подключён"));
  });

  await test("прогревочное письмо распознаётся по маркеру в теле, а не по заголовку", async () => {
    // контракт между warmupEngine (пишет маркер) и inboundEngine (читает его):
    // если он разъедется, служебный трафик попадёт в диалог с лидом
    const code = "abc123XYZ";
    const html = `<div>Привет, как дела?</div>${embedWarmupMarker(code)}`;

    assert.equal(extractWarmupCode({ subject: "Привет", html, text: null }), code);
    assert.equal(
      extractWarmupCode({ subject: "Re: Тема", html: "<div>Сколько стоит?</div>", text: "Сколько стоит?" }),
      null,
      "обычный ответ лида не должен считаться прогревом"
    );
  });
}
