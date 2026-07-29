import { computeFleetHealth } from "@/server/fleetHealth";
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

  await test("ящик в ошибке подключения приостанавливается сразу", async () => {
    const mailbox = await mailboxWithHistory(smtp.port, [], {
      connState: "auth_error",
      connError: "Invalid login",
    });

    await computeFleetHealth();

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
    assert.equal(after.connState, "disabled");
    assert.ok(after.pausedReason?.includes("Invalid login"), "причина из connError сохранена");
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
