import { computeFleetHealth } from "@/server/fleetHealth";
import { deliverAdminNotifications } from "@/server/adminNotifications";
import { reportSharedApiFailure, reportSharedApiSuccess } from "@/lib/services/serviceAlerts";
import { reconnectMailboxes } from "@/server/mailboxReconnect";
import { processCampaign } from "@/server/sendEngine";
import type { FakeSmtp } from "../fakeSmtp";
import {
  assert,
  makeCampaign,
  makeContact,
  makeDomain,
  makeMailbox,
  makeMessage,
  makeQueuedCampaign,
  makeUser,
  prisma,
  suiteHeader,
  test,
} from "../harness";

/**
 * Мониторинг здоровья флота (§5.8). Ключевой контракт, который держится на
 * дисциплине в трёх файлах сразу: connState="disabled" не входит ни в один
 * allow-list движков, поэтому ящик выпадает из отправки/приёма/прогрева без
 * правок их кода. Тест фиксирует это как поведение, а не как договорённость.
 */

/** Ящик + кампания с письмами заданных статусов (сигнал для скоринга). */
async function mailboxWithHistory(
  smtpPort: number,
  statuses: ("SENT" | "FAILED")[],
  mailboxData: Parameters<typeof makeMailbox>[0]["data"] = {}
) {
  const user = await makeUser();
  const domain = await makeDomain(user.id);
  const mailbox = await makeMailbox({
    userId: user.id,
    domainGroupId: domain.id,
    smtpPort,
    data: mailboxData,
  });
  const campaign = await makeCampaign(user.id, { status: "SENT" });
  const contact = await makeContact(user.id);
  for (const status of statuses) {
    await makeMessage(campaign.id, contact.id, { status, mailboxId: mailbox.id });
  }
  return mailbox;
}

export default async function run(smtp: FakeSmtp) {
  suiteHeader("fleetHealth — скоринг и авто-приостановка");

  await test("ящик с долей отказов больше половины приостанавливается", async () => {
    const mailbox = await mailboxWithHistory(smtp.port, [
      "FAILED",
      "FAILED",
      "FAILED",
      "FAILED",
      "SENT",
      "SENT",
    ]);

    const res = await computeFleetHealth();

    assert.equal(res.disabled, 1);
    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
    assert.equal(after.connState, "disabled");
    assert.ok(after.pausedReason?.includes("%"), "причина человекочитаемая, для дашборда");
    assert.ok(after.healthScore < 100);
  });

  await test("на малой выборке ящик не отключается, только падает скоринг", async () => {
    // 4 письма < MIN_SAMPLE: одна неудачная кампания не повод выводить ящик
    const mailbox = await mailboxWithHistory(smtp.port, ["FAILED", "FAILED", "FAILED", "FAILED"]);

    const res = await computeFleetHealth();

    assert.equal(res.disabled, 0);
    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
    assert.equal(after.connState, "ok");
    assert.ok(after.healthScore < 100, "сигнал виден на дашборде, но ротацию не рвём");
  });

  await test("ошибка пароля приостанавливает сразу и ставит одно техническое уведомление", async () => {
    const mailbox = await mailboxWithHistory(smtp.port, [], {
      connState: "auth_error",
      connError: "Invalid login",
    });

    await computeFleetHealth();

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
    assert.equal(after.connState, "disabled");
    assert.equal(after.pauseKind, "AUTH");
    assert.ok(after.pausedReason?.includes("Invalid login"), "причина из connError сохранена");
    assert.equal(await prisma.adminNotification.count(), 1);
  });

  await test("временная сеть не ставит ящик на окончательную паузу и не уведомляет сразу", async () => {
    const mailbox = await mailboxWithHistory(smtp.port, [], {
      connState: "unreachable",
      connError: "ETIMEDOUT",
    });
    const now = new Date("2026-08-12T10:00:00Z");

    await computeFleetHealth(now);

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
    assert.equal(after.connState, "unreachable");
    assert.equal(after.pauseKind, "NETWORK");
    assert.equal(after.reconnectAttempts, 0);
    assert.ok(after.nextReconnectAt && after.nextReconnectAt > now);
    assert.equal(await prisma.adminNotification.count(), 0);
  });

  await test("три неудачных переподключения ставят на паузу и уведомляют один раз за 24 часа", async () => {
    const mailbox = await mailboxWithHistory(smtp.port, [], {
      connState: "unreachable",
      connError: "ETIMEDOUT",
      pauseKind: "NETWORK",
      nextReconnectAt: new Date("2026-08-12T09:00:00Z"),
    });
    const unavailable = async () => ({
      connState: "unreachable" as const,
      smtpOk: false,
      imapOk: false,
      error: "SMTP: ETIMEDOUT",
    });

    await reconnectMailboxes(new Date("2026-08-12T10:00:00Z"), unavailable);
    await reconnectMailboxes(new Date("2026-08-12T11:00:00Z"), unavailable);
    const third = await reconnectMailboxes(new Date("2026-08-12T12:00:00Z"), unavailable);

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
    assert.equal(after.connState, "disabled");
    assert.equal(after.reconnectAttempts, 3);
    assert.equal(third.alerted, 1);
    assert.equal(await prisma.adminNotification.count(), 1);

    await prisma.mailbox.update({ where: { id: mailbox.id }, data: { nextReconnectAt: new Date("2026-08-12T13:00:00Z") } });
    const fourth = await reconnectMailboxes(new Date("2026-08-12T14:00:00Z"), unavailable);
    assert.equal(fourth.alerted, 0);
    assert.equal(await prisma.adminNotification.count(), 1);
  });

  await test("автопроверка возвращает сетевой ящик в прогрев без ручного вмешательства", async () => {
    const mailbox = await mailboxWithHistory(smtp.port, [], {
      connState: "disabled",
      pauseKind: "NETWORK",
      reconnectAttempts: 3,
      pausedReason: "Ошибка подключения: ETIMEDOUT",
      nextReconnectAt: new Date("2026-08-12T09:00:00Z"),
      warmupState: "warming",
    });
    const available = async () => ({ connState: "ok" as const, smtpOk: true, imapOk: true });

    const result = await reconnectMailboxes(new Date("2026-08-12T10:00:00Z"), available);

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
    assert.equal(result.recovered, 1);
    assert.equal(after.connState, "ok");
    assert.equal(after.warmupState, "warming");
    assert.equal(after.pauseKind, null);
    assert.equal(after.reconnectAttempts, 0);
  });

  await test("несколько сервисных событий одной организации уходят одним дайджестом", async () => {
    const user = await makeUser();
    await prisma.adminNotification.createMany({
      data: [
        {
          userId: user.id,
          type: "MAILBOX_PAUSED",
          dedupeKey: "MAILBOX_PAUSED:first",
          recipientEmails: [user.email],
          subject: "Первый ящик",
          text: "Первая техническая проблема",
        },
        {
          userId: user.id,
          type: "MAILBOX_PAUSED",
          dedupeKey: "MAILBOX_PAUSED:second",
          recipientEmails: [user.email],
          subject: "Второй ящик",
          text: "Вторая техническая проблема",
        },
      ],
    });
    const deliveries: { subject: string; text: string }[] = [];
    const sender = async (mail: { subject: string; text: string }) => {
      deliveries.push(mail);
      return { ok: true as const };
    };

    const result = await deliverAdminNotifications(new Date("2099-01-01T00:00:00Z"), sender);

    assert.equal(result.sent, 2);
    assert.equal(result.emails, 1);
    assert.equal(deliveries.length, 1);
    assert.ok(deliveries[0].subject.includes("(2)"));
    assert.ok(deliveries[0].text.includes("Первая техническая проблема"));
    assert.ok(deliveries[0].text.includes("Вторая техническая проблема"));
  });

  await test("общий API уведомляет только после трёх ошибок и не чаще раза в сутки", async () => {
    await reportSharedApiFailure("Test API", new Error("first"));
    await reportSharedApiFailure("Test API", new Error("second"));
    assert.equal(await prisma.adminNotification.count(), 0);

    await reportSharedApiFailure("Test API", new Error("third"));
    await reportSharedApiFailure("Test API", new Error("fourth"));
    assert.equal(await prisma.adminNotification.count(), 1);

    await reportSharedApiSuccess("Test API");
    const incident = await prisma.systemApiIncident.findUniqueOrThrow({ where: { service: "Test API" } });
    assert.equal(incident.failureCount, 0);
    assert.ok(incident.resolvedAt);
  });

  await test("уже приостановленный ящик повторно не пересчитывается", async () => {
    const mailbox = await mailboxWithHistory(smtp.port, ["SENT", "SENT"], {
      connState: "disabled",
      pausedReason: "Поставлено вручную",
      healthScore: 7,
    });

    const res = await computeFleetHealth();

    assert.equal(res.checked, 0, "disabled ждёт ручного «Возобновить», а не авто-реабилитации");
    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
    assert.equal(after.pausedReason, "Поставлено вручную");
    assert.equal(after.healthScore, 7);
  });

  await test("приостановленный ящик выпадает из холодной отправки", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
      data: { connState: "disabled" },
    });
    const { campaign } = await makeQueuedCampaign(user.id, 3);

    const res = await processCampaign(campaign.id);

    assert.equal(res.sent, 0, "disabled не входит в allow-list пула отправки");
    assert.equal(res.remaining, 3, "письма ждут живого ящика, а не помечаются провалом");
    assert.equal(smtp.received.length, 0);
  });

  await test("«paused» — это не «disabled»: такой ящик остаётся в ротации", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
      // paused = только что подключён, ждёт первого успеха
      data: { connState: "paused" },
    });
    const { campaign } = await makeQueuedCampaign(user.id, 2);

    const res = await processCampaign(campaign.id);

    assert.equal(res.sent, 2, "иначе новый ящик никогда не подтвердит логин");
    const mailbox = await prisma.mailbox.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(mailbox.connState, "ok", "первая успешная отправка подтверждает подключение");
  });
}
