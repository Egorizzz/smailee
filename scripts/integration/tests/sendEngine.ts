import { processCampaign, processFollowups } from "@/server/sendEngine";
import type { FakeSmtp } from "../fakeSmtp";
import {
  assert,
  daysAgo,
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

// Окно отправки для тестов, не зависящее от глобального config.sendWindow
// (тот отключён в run.ts для всех прочих тестов) — инжектируется явно.
const MSK_WINDOW = { enabled: true, timeZone: "Europe/Moscow", startHour: 9, endHour: 19, weekdays: [1, 2, 3, 4, 5] };

/**
 * Движок отправки (§5.3). Проверяем инварианты, которые живут в накопленном
 * состоянии БД и потому не ловятся ни тайпчеком, ни smoke-тестами:
 * дневные лимиты ящика и домена, закрепление ящика за перепиской (sticky),
 * suppression, поведение при ошибке аутентификации и резюмируемость очереди.
 *
 * Цена регрессии здесь — сожжённый домен и «Re:» с чужого адреса, поэтому
 * набор самый подробный.
 */
export default async function run(smtp: FakeSmtp) {
  suiteHeader("sendEngine — лимиты, ротация, sticky-ящик");

  await test("дневной лимит ящика не превышается, остаток очереди ждёт", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
      data: { coldDailyLimit: 3 },
    });
    const { campaign } = await makeQueuedCampaign(user.id, 10);

    const res = await processCampaign(campaign.id);

    assert.equal(res.sent, 3, "должно уйти ровно coldDailyLimit писем");
    assert.equal(res.remaining, 7, "остальные остаются PENDING (резюмируемость)");
    assert.equal(smtp.received.length, 3, "по SMTP реально ушло столько же, сколько в отчёте");
  });

  await test("лимит домена общий для всех его ящиков", async () => {
    smtp.reset();
    const user = await makeUser();
    // 2 ящика по 30 писем на одном домене с лимитом 4: ограничивает домен
    const domain = await makeDomain(user.id, { dailyLimit: 4 });
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    const { campaign } = await makeQueuedCampaign(user.id, 10);

    const res = await processCampaign(campaign.id);

    assert.equal(res.sent, 4, "суммарно по домену не больше dailyLimit");
    const domainAfter = await prisma.domainGroup.findUniqueOrThrow({ where: { id: domain.id } });
    assert.equal(domainAfter.sentToday, 4, "счётчик домена сходится с фактом");
  });

  await test("на новый день счётчики сбрасываются и очередь добивается", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    const mailbox = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
      data: { coldDailyLimit: 3 },
    });
    const { campaign } = await makeQueuedCampaign(user.id, 10);

    await processCampaign(campaign.id);
    // наступили следующие сутки: дата счётчика вчерашняя, сам счётчик не тронут
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: { coldSentDate: daysAgo(1) },
    });
    const second = await processCampaign(campaign.id);

    assert.equal(second.sent, 3, "после смены даты ящик снова может слать");
    assert.equal(second.remaining, 4, "очередь добивается порциями, письма не теряются");
  });

  await test("follow-up уходит с того же ящика, что и первое письмо", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    // ящик A временно не прогрет — первое письмо обязано уйти через B.
    // createdAt задаём явно: ротация идёт по нему, и A обязан быть ПЕРВЫМ —
    // иначе тест пройдёт вхолостую (без sticky движок и так выбрал бы B).
    const boxA = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
      email: "a@test.local",
      data: { warmupState: "warming", createdAt: daysAgo(2) },
    });
    const boxB = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
      email: "b@test.local",
      data: { createdAt: daysAgo(1) },
    });
    const campaign = await makeCampaign(user.id);
    const contact = await makeContact(user.id);
    await makeMessage(campaign.id, contact.id);

    await processCampaign(campaign.id);
    assert.equal(smtp.sentFrom(boxB.email).length, 1, "первое письмо ушло с B");

    // A прогрелся и встал в ротацию первым — без sticky follow-up ушёл бы с него
    await prisma.mailbox.update({ where: { id: boxA.id }, data: { warmupState: "warm" } });
    await makeMessage(campaign.id, contact.id, { step: 1, subject: "Re: Тема" });
    await processCampaign(campaign.id);

    assert.equal(smtp.sentFrom(boxB.email).length, 2, "follow-up тоже ушёл с B");
    assert.equal(smtp.sentFrom(boxA.email).length, 0, "с A контакту не писали — тред не разорван");
  });

  await test("sticky-ящик исчерпал квоту: письмо ждёт, а не уходит с чужого адреса", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    const boxA = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
      email: "free@test.local",
      // первый в ротации: без sticky именно он подхватил бы follow-up
      data: { warmupState: "warming", createdAt: daysAgo(2) },
    });
    const boxB = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
      email: "sticky@test.local",
      data: { coldDailyLimit: 1, createdAt: daysAgo(1) },
    });
    const campaign = await makeCampaign(user.id);
    const contact = await makeContact(user.id);
    await makeMessage(campaign.id, contact.id);

    await processCampaign(campaign.id); // первое письмо съедает единственный слот B
    await prisma.mailbox.update({ where: { id: boxA.id }, data: { warmupState: "warm" } });
    const followup = await makeMessage(campaign.id, contact.id, { step: 1, subject: "Re: Тема" });
    const res = await processCampaign(campaign.id);

    assert.equal(res.sent, 0, "свободный ящик A не подхватывает чужую переписку");
    assert.equal(smtp.sentFrom(boxA.email).length, 0, "с A писем не было");
    const after = await prisma.message.findUniqueOrThrow({ where: { id: followup.id } });
    assert.equal(after.status, "PENDING", "письмо ждёт завтрашней квоты B");
    assert.equal(boxB.email, "sticky@test.local");
  });

  await test("контакт в suppression-списке не получает письмо", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    const campaign = await makeCampaign(user.id);
    const blocked = await makeContact(user.id, { email: "blocked@example.test" });
    const allowed = await makeContact(user.id, { email: "allowed@example.test" });
    const blockedMsg = await makeMessage(campaign.id, blocked.id);
    await makeMessage(campaign.id, allowed.id);
    await prisma.suppression.create({
      data: { userId: user.id, email: "blocked@example.test", reason: "unsubscribed" },
    });

    const res = await processCampaign(campaign.id);

    assert.equal(res.sent, 1, "уходит только разрешённому контакту");
    assert.equal(res.skipped, 1);
    assert.equal(smtp.received.length, 1, "по SMTP отписавшемуся ничего не ушло");
    assert.equal(smtp.received[0].to[0], "allowed@example.test");
    const after = await prisma.message.findUniqueOrThrow({ where: { id: blockedMsg.id } });
    assert.equal(after.status, "FAILED");
  });

  await test("отписавшийся контакт (status=UNSUBSCRIBED) не получает письмо", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    const campaign = await makeCampaign(user.id);
    const contact = await makeContact(user.id, { status: "UNSUBSCRIBED" });
    await makeMessage(campaign.id, contact.id);

    const res = await processCampaign(campaign.id);

    assert.equal(res.sent, 0);
    assert.equal(res.skipped, 1);
    assert.equal(smtp.received.length, 0, "статус контакта — второй барьер помимо suppression");
  });

  await test("ошибка аутентификации выводит ящик из ротации и помечает connState", async () => {
    smtp.reset();
    smtp.failAuth = true;
    try {
      const user = await makeUser();
      const domain = await makeDomain(user.id);
      const mailbox = await makeMailbox({
        userId: user.id,
        domainGroupId: domain.id,
        smtpPort: smtp.port,
      });
      const { campaign } = await makeQueuedCampaign(user.id, 3);

      const res = await processCampaign(campaign.id);

      assert.equal(res.sent, 0);
      assert.equal(res.failed, 1, "падаем на первом письме и не долбим мёртвый ящик остальными");
      const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
      assert.equal(after.connState, "auth_error");
      assert.ok(after.connError, "причина сохранена для подсветки в UI");
      assert.equal(res.remaining, 2, "оставшиеся письма ждут починки ящика");
    } finally {
      smtp.failAuth = false;
    }
  });

  await test("без трекинга текстовое письмо уходит чистым text/plain", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    // trackingEnabled по умолчанию false — так и должно быть у новой кампании
    const campaign = await makeCampaign(user.id);
    const contact = await makeContact(user.id);
    await makeMessage(campaign.id, contact.id, { isHtml: false });

    await processCampaign(campaign.id);

    const raw = smtp.received[0].data;
    // HTML-часть нужна только ради пикселя: без трекинга она лишняя и вредит
    assert.ok(!raw.includes("multipart/alternative"), "письмо не составное");
    assert.ok(!raw.includes("text/html"), "HTML-двойника нет");
    assert.ok(!raw.includes("/api/track/open/"), "пикселя нет");
  });

  await test("с трекингом текстовое письмо уходит двумя частями", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    const campaign = await makeCampaign(user.id, { trackingEnabled: true });
    const contact = await makeContact(user.id);
    await makeMessage(campaign.id, contact.id, { isHtml: false });

    await processCampaign(campaign.id);

    const raw = smtp.received[0].data;
    // пиксель и подмена ссылок живут только в HTML — без второй части
    // текстовые кампании (а это большинство холодных) не отследить вовсе
    assert.ok(raw.includes("multipart/alternative"), "письмо составное");
    assert.ok(raw.includes("text/plain"), "чистая текстовая версия на месте");
    assert.ok(raw.includes("text/html"), "HTML-двойник с трекингом тоже");
  });

  await test("HTML-кампания без трекинга не получает пиксель", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    const campaign = await makeCampaign(user.id);
    const contact = await makeContact(user.id);
    await makeMessage(campaign.id, contact.id, {
      isHtml: true,
      body: '<p>Привет</p><a href="https://example.com/page">ссылка</a>',
    });

    await processCampaign(campaign.id);

    const raw = smtp.received[0].data;
    assert.ok(!raw.includes("/api/track/open/"), "пикселя нет");
    assert.ok(!raw.includes("/api/track/click/"), "ссылки не подменены");
  });

  await test("вне рабочего окна кампания не шлёт и не трогает очередь", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    const { campaign } = await makeQueuedCampaign(user.id, 3);

    // суббота днём по Москве — не рабочий день, вне зависимости от часа
    const res = await processCampaign(campaign.id, new Date("2026-08-08T10:00:00Z"), MSK_WINDOW);

    assert.equal(res.sent, 0);
    assert.equal(res.remaining, 3, "письма остались нетронутыми, не «зависли» в QUEUED");
    assert.equal(smtp.received.length, 0);
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    assert.equal(after.status, "QUEUED", "статус SENDING не проставляется вне окна");
  });

  await test("внутри рабочего окна кампания отправляет как обычно", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    const { campaign } = await makeQueuedCampaign(user.id, 3);

    // будний день, рабочие часы по Москве
    const res = await processCampaign(campaign.id, new Date("2026-08-04T10:00:00Z"), MSK_WINDOW);

    assert.equal(res.sent, 3);
    assert.equal(smtp.received.length, 3);
  });

  await test("одновременные проходы не отправляют письмо дважды", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    const { campaign } = await makeQueuedCampaign(user.id, 6);

    // Ровно то, что происходит на проде: launchCampaign шлёт синхронно в
    // веб-процессе, а воркер параллельно забирает ту же кампанию по статусу
    // QUEUED/SENDING. Без захвата писем оба прохода читают один список PENDING.
    const [a, b] = await Promise.all([processCampaign(campaign.id), processCampaign(campaign.id)]);

    assert.equal(smtp.received.length, 6, "каждому контакту ровно одно письмо");
    assert.equal(a.sent + b.sent, 6, "суммарный отчёт совпадает с фактом");
    const sentInDb = await prisma.message.count({ where: { campaignId: campaign.id, status: "SENT" } });
    assert.equal(sentInDb, 6);
  });

  await test("кампания переходит в SENT, когда очередь опустела", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({ userId: user.id, domainGroupId: domain.id, smtpPort: smtp.port });
    const { campaign } = await makeQueuedCampaign(user.id, 2);

    await processCampaign(campaign.id);

    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    assert.equal(after.status, "SENT");
    assert.ok(after.startedAt, "старт кампании зафиксирован");
  });

  await test("follow-up создаётся только для неотвеченных писем старше followupDays", async () => {
    smtp.reset();
    const user = await makeUser();
    const campaign = await makeCampaign(user.id, {
      followupEnabled: true,
      followupDays: 3,
      status: "SENT",
    });
    const stale = await makeContact(user.id);
    const fresh = await makeContact(user.id);
    const answered = await makeContact(user.id);
    await makeMessage(campaign.id, stale.id, { status: "SENT", sentAt: daysAgo(5) });
    await makeMessage(campaign.id, fresh.id, { status: "SENT", sentAt: daysAgo(1) });
    await makeMessage(campaign.id, answered.id, {
      status: "REPLIED",
      sentAt: daysAgo(5),
      repliedAt: daysAgo(4),
    });

    const created = await processFollowups(campaign.id);
    assert.equal(created, 1, "только письмо без ответа и старше порога");

    const again = await processFollowups(campaign.id);
    assert.equal(again, 0, "повторный проход не плодит дубли (followupSentAt)");

    const followups = await prisma.message.findMany({ where: { campaignId: campaign.id, step: 1 } });
    assert.equal(followups.length, 1);
    assert.equal(followups[0].contactId, stale.id);
  });
}
