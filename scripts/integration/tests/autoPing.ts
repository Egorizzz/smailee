import { processAutoPings } from "@/server/autoPingEngine";
import { handleInboundReply } from "@/server/inboundEngine";
import type { FakeSmtp } from "../fakeSmtp";
import type { FakeBitrix } from "../fakeBitrix";
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

async function makeFrozenConversation(smtpPort: number, data: { nextContactAt?: Date; attempts?: number; maxAttempts?: number; startAfterDays?: number } = {}) {
  const user = await makeUser({ autoPingEnabled: true, autoPingStartAfterDays: data.startAfterDays ?? 7, autoPingIntervalDays: 2, autoPingMaxAttempts: data.maxAttempts ?? 3 });
  const domain = await makeDomain(user.id);
  const mailbox = await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort });
  const campaign = await makeCampaign(user.id, { status: "SENT" });
  const contact = await makeContact(user.id);
  const message = await makeMessage(campaign.id, contact.id, {
    status: "REPLIED",
    sentAt: daysAgo(10),
    repliedAt: daysAgo(9),
    mailboxId: mailbox.id,
    messageIdHeader: "<autoping-root@smailee.test>",
    nextContactAt: data.nextContactAt,
    autoPingAttempts: data.attempts ?? 0,
  });
  await prisma.replyMessage.createMany({ data: [
    { messageId: message.id, direction: "inbound", body: "Да, пришлите детали.", status: "SENT", createdAt: daysAgo(9), externalMessageId: "<client-reply@example.test>" },
    { messageId: message.id, direction: "outbound", body: "Отправил детали. Что думаете?", status: "SENT", createdAt: daysAgo(8), isAi: false },
  ] });
  return { user, message };
}

export default async function run(smtp: FakeSmtp, _bitrix: FakeBitrix) {
  suiteHeader("autoPingEngine — возврат остывших диалогов");

  await test("после 7 дней тишины создаёт редактируемый черновик и отправляет сохранённый текст по расписанию", async () => {
    smtp.reset();
    const { message } = await makeFrozenConversation(smtp.port);

    const prepared = await processAutoPings();

    assert.equal(prepared.drafted, 1);
    assert.equal(prepared.sent, 0);
    assert.equal(smtp.received.length, 0);
    const draft = await prisma.replyMessage.findFirstOrThrow({ where: { messageId: message.id, kind: "AUTO_PING", status: "DRAFT" } });
    assert.ok(draft.scheduledAt);
    await prisma.replyMessage.update({ where: { id: draft.id }, data: { body: "Ручная правка автопинга", isAi: false } });

    const delivered = await processAutoPings(draft.scheduledAt!);

    assert.equal(delivered.sent, 1);
    assert.equal(smtp.received.length, 1);
    const updated = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    assert.equal(updated.autoPingAttempts, 1);
    assert.ok(updated.autoPingLastSentAt);
    assert.ok(updated.autoPingNextAt && updated.autoPingNextAt > new Date());
    const sentReply = await prisma.replyMessage.findFirstOrThrow({ where: { id: draft.id } });
    assert.equal(sentReply.status, "SENT");
    assert.equal(sentReply.body, "Ручная правка автопинга");
  });

  await test("явно названная будущая дата откладывает автопинг", async () => {
    smtp.reset();
    await makeFrozenConversation(smtp.port, { nextContactAt: new Date(Date.now() + 5 * 86_400_000) });

    const result = await processAutoPings();

    assert.equal(result.sent, 0);
    assert.equal(smtp.received.length, 0);
  });

  await test("общая настройка задержки управляет первым автопингом", async () => {
    smtp.reset();
    await makeFrozenConversation(smtp.port, { startAfterDays: 10 });

    const result = await processAutoPings();

    assert.equal(result.sent, 0);
    assert.equal(smtp.received.length, 0);
  });

  await test("новый ответ клиента сразу останавливает автопинг", async () => {
    smtp.reset();
    const { message } = await makeFrozenConversation(smtp.port);
    const prepared = await processAutoPings();
    assert.equal(prepared.drafted, 1);
    await handleInboundReply({ messageId: message.id, inboundBody: "Спасибо, отвечу завтра." });

    const result = await processAutoPings();

    assert.equal(result.sent, 0);
    assert.equal(smtp.received.length, 0);
    assert.equal(await prisma.replyMessage.count({ where: { messageId: message.id, kind: "AUTO_PING", status: "DRAFT" } }), 0);
  });

  await test("последняя разрешённая попытка останавливает сценарий", async () => {
    smtp.reset();
    const { message } = await makeFrozenConversation(smtp.port, { attempts: 1, maxAttempts: 2 });

    const prepared = await processAutoPings();
    assert.equal(prepared.drafted, 1);
    const draft = await prisma.replyMessage.findFirstOrThrow({ where: { messageId: message.id, kind: "AUTO_PING", status: "DRAFT" } });
    const result = await processAutoPings(draft.scheduledAt!);

    assert.equal(result.sent, 1);
    const updated = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    assert.equal(updated.autoPingAttempts, 2);
    assert.ok(updated.autoPingStoppedAt);
    assert.equal(updated.autoPingNextAt, null);
  });
}
