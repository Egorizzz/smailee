import { processWarmupSendRound } from "@/server/warmupEngine";
import { config } from "@/lib/config";
import type { FakeSmtp } from "../fakeSmtp";
import {
  assert,
  daysAgo,
  makeDomain,
  makeMailbox,
  makeUser,
  prisma,
  suiteHeader,
  test,
} from "../harness";

/**
 * Движок прогрева (§5.6). Набор написан по следам двух реальных багов, которые
 * не поймала ни одна проверка (коммиты 9f5f155 и bf36866):
 *
 *   1. warm выдавался по календарю, без единой реальной отправки;
 *   2. выбор пиров вставал намертво в сети меньше ~16 ящиков.
 *
 * Оба видны только на накопленном состоянии БД после нескольких раундов —
 * ровно то, что тайпчек и тесты чистых функций не покрывают в принципе.
 */

const RAMP_DAYS = config.warmup.rampDays;

/** Прогреваемый ящик, у которого ramp формально давно позади (день > 14). */
async function makeWarmingMailbox(smtpPort: number, email: string, isSeed = false) {
  const user = await makeUser();
  const domain = await makeDomain(user.id);
  return makeMailbox({
    userId: user.id,
    domainGroupId: domain.id,
    smtpPort,
    email,
    data: {
      isSeed,
      warmupState: isSeed ? "off" : "warming",
      warmupStartedAt: daysAgo(RAMP_DAYS + 6),
    },
  });
}

async function sentCount(mailboxId: string): Promise<number> {
  return prisma.warmupEvent.count({
    where: { senderMailboxId: mailboxId, status: { not: "failed" } },
  });
}

export default async function run(smtp: FakeSmtp) {
  suiteHeader("warmupEngine — ramp, выбор пиров, переход в warm");

  await test("сеть из двух ящиков накапливает отправки раунд за раундом", async () => {
    smtp.reset();
    const a = await makeWarmingMailbox(smtp.port, "warm-a@test.local");
    const b = await makeWarmingMailbox(smtp.port, "warm-b@test.local");

    for (let i = 0; i < 5; i++) await processWarmupSendRound();

    // Регрессия на bf36866: раньше окно исключения пиров было жёстким (15),
    // единственный сосед попадал в него навсегда и счётчик замирал на 1.
    assert.equal(await sentCount(a.id), 5, "ящик A шлёт каждый раунд, а не замолкает");
    assert.equal(await sentCount(b.id), 5, "ящик B тоже");
    assert.equal(smtp.received.length, 10, "письма реально ушли по SMTP");
  });

  await test("ящик не становится warm, пока не набрано реальных отправок", async () => {
    smtp.reset();
    const a = await makeWarmingMailbox(smtp.port, "slow-a@test.local");
    await makeWarmingMailbox(smtp.port, "slow-b@test.local");

    for (let i = 0; i < RAMP_DAYS; i++) await processWarmupSendRound();

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: a.id } });
    // Регрессия на 9f5f155: календарный день давно за порогом (ramp+6),
    // но порога по реальным письмам ещё нет — warm выдавать нельзя.
    assert.ok(after.warmupDay > RAMP_DAYS, "календарно ramp давно прошёл");
    assert.equal(after.warmupState, "warming", "warm по календарю не выдаётся");
    assert.equal(await sentCount(a.id), RAMP_DAYS, "к этому моменту накоплено ровно RAMP_DAYS писем");
  });

  await test("ящик становится warm, когда порог реально набран", async () => {
    smtp.reset();
    const a = await makeWarmingMailbox(smtp.port, "ok-a@test.local");
    await makeWarmingMailbox(smtp.port, "ok-b@test.local");

    // на раунде RAMP_DAYS+1 движок видит уже RAMP_DAYS отправленных писем
    for (let i = 0; i < RAMP_DAYS + 1; i++) await processWarmupSendRound();

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(after.warmupState, "warm");
  });

  await test("только что подключённый ящик стартует прогрев сам", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    const fresh = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
      email: "fresh@test.local",
      data: { warmupState: "off", warmupStartedAt: null, connState: "paused" },
    });
    await makeWarmingMailbox(smtp.port, "peer@test.local", true); // seed-пир

    await processWarmupSendRound();

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: fresh.id } });
    // §5.6: прогрев «никогда не выключается» и не требует отдельного шага оператора
    assert.equal(after.warmupState, "warming");
    assert.ok(after.warmupStartedAt, "точка отсчёта ramp проставлена");
    assert.equal(after.warmupDay, 1);
  });

  await test("seed-ящик участвует как пир, но сам не прогревается", async () => {
    smtp.reset();
    const seed = await makeWarmingMailbox(smtp.port, "seed@test.local", true);
    const client = await makeWarmingMailbox(smtp.port, "client@test.local");

    await processWarmupSendRound();

    assert.equal(await sentCount(seed.id), 0, "seed не гоняет собственный ramp");
    assert.equal(await sentCount(client.id), 1, "клиентский ящик прогревается об него");
    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: seed.id } });
    assert.equal(after.warmupState, "off", "состояние seed не трогаем");
  });

  await test("ящики разных клиентов переписываются между собой", async () => {
    smtp.reset();
    // пул прогрева намеренно НЕ фильтруется по userId (кросс-клиентская сеть)
    const a = await makeWarmingMailbox(smtp.port, "tenant-a@test.local");
    const b = await makeWarmingMailbox(smtp.port, "tenant-b@test.local");
    const aBox = await prisma.mailbox.findUniqueOrThrow({ where: { id: a.id } });
    const bBox = await prisma.mailbox.findUniqueOrThrow({ where: { id: b.id } });
    assert.notEqual(aBox.userId, bBox.userId, "ящики принадлежат разным клиентам");

    await processWarmupSendRound();

    const event = await prisma.warmupEvent.findFirstOrThrow({ where: { senderMailboxId: a.id } });
    assert.equal(event.recipientMailboxId, b.id, "письмо ушло ящику другого клиента");
  });

  await test("приостановленный по здоровью ящик (disabled) выпадает из прогрева", async () => {
    smtp.reset();
    const active = await makeWarmingMailbox(smtp.port, "active@test.local");
    const dead = await makeWarmingMailbox(smtp.port, "dead@test.local");
    await prisma.mailbox.update({ where: { id: dead.id }, data: { connState: "disabled" } });

    await processWarmupSendRound();

    assert.equal(await sentCount(dead.id), 0, "disabled сам не шлёт");
    assert.equal(
      await sentCount(active.id),
      0,
      "и не может быть пиром — писать больше некому, раунд пустой"
    );
    assert.equal(smtp.received.length, 0);
  });
}
