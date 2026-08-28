import {
  processWarmupSendRound,
  randomizedUnlockedWarmupTarget,
  warmupDailyTarget,
  warmupEngagementDelayMs,
  warmupMinimumGapMs,
  warmupSendSlotProgresses,
} from "@/server/warmupEngine";
import { config } from "@/lib/config";
import { warmupRequiredBeforeCampaign } from "@/lib/mail/deliverabilityRules";
import { confirmedWarmupData } from "@/server/mailboxProvisioning";
import { pickContinuation, pickOpener, pickResponse } from "@/lib/warmup/corpus";
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
const REQUIRED_WARMUP_SENDS = warmupRequiredBeforeCampaign();

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

// Окно отправки для тестов, не зависящее от глобального config.sendWindow
// (тот отключён в run.ts для всех прочих тестов) — инжектируется явно.
// Даты в isoWithinSendWindow/сценариях ниже — в UTC, подобраны так, чтобы
// после конвертации в MSK (+3, без перехода на летнее время) дать нужный
// день недели и час, независимо от локальной TZ машины, где идёт прогон.
const MSK_WINDOW = { enabled: true, timeZone: "Europe/Moscow", startHour: 9, endHour: 19, weekdays: [1, 2, 3, 4, 5] };
const MSK_WARMUP_WINDOW = { ...MSK_WINDOW, weekdays: [1, 2, 3, 4, 5, 6, 7] };

/**
 * Симулирует наступление нового календарного дня для дневного счётчика
 * прогрева — так же, как это происходит в проде (processWarmupSendRound сам
 * детектирует смену даты через isSameDay и сбрасывает warmupSentToday).
 *
 * Нужна с тех пор, как потолок прогрева (config.warmup.dailyMax) стал меньше
 * RAMP_DAYS: раньше цикл из RAMP_DAYS раундов без сброса всё равно укладывался
 * в дневной лимит 20-30, теперь потолок 10 — без явной симуляции дней тесты
 * упирались бы в него на середине цикла и переставали слать.
 */
async function rollWarmupDayBack(mailboxIds: string[]) {
  await prisma.mailbox.updateMany({
    where: { id: { in: mailboxIds } },
    data: { warmupSentDate: daysAgo(1) },
  });
}

export default async function run(smtp: FakeSmtp) {
  suiteHeader("warmupEngine — ramp, выбор пиров, переход в warm");

  await test("подтверждённый прогретый ящик сразу получает финальный день ramp", async () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const state = confirmedWarmupData(now);

    assert.equal(state.warmupState, "warm");
    assert.equal(state.warmupDay, RAMP_DAYS);
    assert.equal(
      now.getTime() - state.warmupStartedAt.getTime(),
      (RAMP_DAYS - 1) * config.warmup.dayMs,
      "дата начала соответствует последнему дню ramp и сохраняет поддерживающий прогрев",
    );
  });

  await test("дневные отправки получают разные устойчивые случайные слоты", async () => {
    const slots = warmupSendSlotProgresses("mailbox-a", "2026-08-27", 10);
    const sameSlots = warmupSendSlotProgresses("mailbox-a", "2026-08-27", 10);
    const nextDaySlots = warmupSendSlotProgresses("mailbox-a", "2026-08-28", 10);
    const otherMailboxSlots = warmupSendSlotProgresses("mailbox-b", "2026-08-27", 10);

    assert.deepEqual(slots, sameSlots, "рестарт не перестраивает расписание текущего дня");
    assert.notDeepEqual(slots, nextDaySlots, "на следующий день расписание меняется");
    assert.notDeepEqual(slots, otherMailboxSlots, "ящики не отправляют синхронно");
    assert.equal(slots.length, 10);
    assert.ok(slots.every((slot, index) => slot > 0 && slot < 1 && (index === 0 || slot > slots[index - 1])));
    assert.ok(
      new Set(slots.map((slot) => Math.floor(slot * 10 * 60) % 60)).size >= 6,
      "минуты отправки не повторяют один и тот же почасовой шаблон",
    );
    assert.equal(randomizedUnlockedWarmupTarget("mailbox-a", "2026-08-27", 10, 0), 0);
    assert.equal(randomizedUnlockedWarmupTarget("mailbox-a", "2026-08-27", 10, 1), 10);
    const minimumGap = warmupMinimumGapMs("mailbox-a", "2026-08-27", 3);
    const engagementDelay = warmupEngagementDelayMs("event-a");
    assert.ok(minimumGap >= 12 * 60_000 && minimumGap <= 32 * 60_000);
    assert.ok(engagementDelay >= 6 * 60_000 && engagementDelay <= 180 * 60_000);
  });

  await test("корпус даёт тысячу уникальных полноценных сообщений каждого типа", async () => {
    const openers = new Set<string>();
    const responses = new Set<string>();
    const continuations = new Set<string>();
    let shortestOpener = Number.POSITIVE_INFINITY;
    let shortestResponse = Number.POSITIVE_INFINITY;
    let shortestContinuation = Number.POSITIVE_INFINITY;
    const words = (value: string) => value.trim().split(/\s+/).length;

    for (let index = 0; index < 1_000; index += 1) {
      const opener = pickOpener(`corpus-opener-${index}`);
      const response = pickResponse(opener.node.id, `corpus-response-${index}`);
      assert.ok(response, "у каждого opener должен быть связанный ответ");
      const continuation = pickContinuation(response.node.id, `corpus-continuation-${index}`);
      assert.ok(continuation, "у каждого ответа должно быть связанное продолжение");

      openers.add(`${opener.rendered.subject}\n${opener.rendered.body}`);
      responses.add(response.rendered.body);
      continuations.add(continuation.rendered.body);
      shortestOpener = Math.min(shortestOpener, words(opener.rendered.body));
      shortestResponse = Math.min(shortestResponse, words(response.rendered.body));
      shortestContinuation = Math.min(shortestContinuation, words(continuation.rendered.body));
    }

    assert.equal(openers.size, 1_000);
    assert.equal(responses.size, 1_000);
    assert.equal(continuations.size, 1_000);
    assert.ok(shortestOpener >= 70, `короткий opener: ${shortestOpener} слов`);
    assert.ok(shortestResponse >= 60, `короткий ответ: ${shortestResponse} слов`);
    assert.ok(shortestContinuation >= 45, `короткое продолжение: ${shortestContinuation} слов`);
  });

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
    const b = await makeWarmingMailbox(smtp.port, "slow-b@test.local");

    // RAMP_DAYS отдельных календарных дней, по одному раунду в каждом — иначе
    // раунды упрутся в дневной потолок (10) раньше, чем наберут RAMP_DAYS (14)
    for (let i = 0; i < RAMP_DAYS; i++) {
      await processWarmupSendRound();
      await rollWarmupDayBack([a.id, b.id]);
    }

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: a.id } });
    // Регрессия на 9f5f155: календарный день давно за порогом (ramp+6),
    // но порога по реальным письмам ещё нет — warm выдавать нельзя.
    assert.ok(after.warmupDay > RAMP_DAYS, "календарно ramp давно прошёл");
    assert.equal(after.warmupState, "warming", "warm по календарю не выдаётся");
    assert.equal(await sentCount(a.id), RAMP_DAYS, "к этому моменту накоплено ровно RAMP_DAYS писем");
  });

  await test("ящик становится warm только после полного объёма ramp", async () => {
    smtp.reset();
    const a = await makeWarmingMailbox(smtp.port, "ok-a@test.local");
    const b = await makeWarmingMailbox(smtp.port, "ok-b@test.local");

    // В каждый симулированный день добираем всю доступную квоту ramp.
    for (let day = 0; day < RAMP_DAYS; day++) {
      const now = daysAgo(RAMP_DAYS - day - 1);
      for (let round = 0; round < config.warmup.dailyMax; round++) {
        await processWarmupSendRound(now);
      }
    }
    await processWarmupSendRound();

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: a.id } });
    assert.ok(await sentCount(a.id) >= REQUIRED_WARMUP_SENDS);
    assert.equal(after.warmupState, "warm");
  });

  await test("прогрев идёт днём в выходные", async () => {
    smtp.reset();
    const a = await makeWarmingMailbox(smtp.port, "weekend-a@test.local");
    await makeWarmingMailbox(smtp.port, "weekend-b@test.local");

    // Суббота, 18:45 по Москве: день разрешён, и первый случайный слот уже
    // гарантированно открыт для обоих ящиков.
    const res = await processWarmupSendRound(new Date("2026-08-08T15:45:00Z"), MSK_WARMUP_WINDOW);

    assert.ok(res.sent > 0);
    assert.ok((await sentCount(a.id)) > 0);
  });

  await test("вне дневного окна прогрев не шлёт", async () => {
    smtp.reset();
    const a = await makeWarmingMailbox(smtp.port, "night-a@test.local");
    await makeWarmingMailbox(smtp.port, "night-b@test.local");

    // Суббота, 23:00 по Москве: день разрешён, ночное время — нет.
    const res = await processWarmupSendRound(new Date("2026-08-08T20:00:00Z"), MSK_WARMUP_WINDOW);

    assert.equal(res.sent, 0);
    assert.equal(await sentCount(a.id), 0);
  });

  await test("дневная квота прогрева размазана по окну, а не открывается разом", async () => {
    // Регрессия на реальный инцидент 2026-07-31: письма прогрева уходили в
    // 3 ночи по Москве одним залпом — счётчик дня сбрасывался по UTC-полуночи,
    // и первый же тик воркера высылал всю дневную цель разом. Проверяем, что
    // квота открывается ПОСТЕПЕННО по мере хода рабочего дня, а не по числу
    // попыток или наличию свободных пиров.
    smtp.reset();
    const a = await makeWarmingMailbox(smtp.port, "spread-a@test.local");
    await makeWarmingMailbox(smtp.port, "spread-b@test.local");
    await prisma.mailbox.update({
      where: { id: a.id },
      data: { warmupStartedAt: new Date("2026-07-15T06:00:00Z"), warmupDay: RAMP_DAYS + 6 },
    });

    const dayKey = "2026-08-04";
    const target = warmupDailyTarget(a.id, RAMP_DAYS + 6);
    const [firstSlot] = warmupSendSlotProgresses(a.id, dayKey, target);
    const firstSlotAt = new Date(
      new Date("2026-08-04T06:00:00Z").getTime() + Math.ceil(firstSlot * 10 * 60 * 60_000) + 1_000,
    );

    // Первый проход сразу после индивидуального случайного слота отправляет
    // одно письмо, а не всю накопившуюся дневную цель.
    await processWarmupSendRound(firstSlotAt, MSK_WINDOW);
    assert.equal(await sentCount(a.id), 1, "в первом случайном слоте уходит одно письмо");

    // повторный проход В ТУ ЖЕ МИНУТУ: время не сдвинулось — квота тоже.
    // Пир свободен, дневная цель далека от исчерпания, но письмо не уйдёт —
    // это доказывает, что ограничитель именно временной, а не по попыткам.
    await processWarmupSendRound(firstSlotAt, MSK_WINDOW);
    assert.equal(await sentCount(a.id), 1, "без хода времени квота не растёт");

    // 12:00 MSK — прогресс 0.3: слотов больше, но ещё не вся дневная цель
    await processWarmupSendRound(new Date("2026-08-04T09:00:00Z"), MSK_WINDOW);
    const midday = await sentCount(a.id);
    assert.ok(midday > 1, `к середине дня должно открыться больше слотов, получено ${midday}`);
    assert.ok(midday < 9, `но не вся дневная цель разом, получено ${midday}`);
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

  await test("задержка worker не сбрасывает подключённый ящик обратно на день 1", async () => {
    smtp.reset();
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    const connectedAt = daysAgo(3);
    const delayed = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
      email: "delayed-start@test.local",
      data: {
        warmupState: "off",
        warmupStartedAt: null,
        createdAt: connectedAt,
      },
    });
    await makeWarmingMailbox(smtp.port, "delayed-peer@test.local", true);

    await processWarmupSendRound();

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: delayed.id } });
    assert.ok(after.warmupStartedAt);
    assert.equal(after.warmupStartedAt.getTime(), connectedAt.getTime());
    assert.ok(after.warmupDay >= 4, `ожидался минимум день 4, получен ${after.warmupDay}`);
  });

  await test("неудачная SMTP-попытка видна в истории и состоянии ящика", async () => {
    smtp.reset();
    const a = await makeWarmingMailbox(smtp.port, "failed-a@test.local");
    await makeWarmingMailbox(smtp.port, "failed-b@test.local");
    smtp.failAuth = true;

    const result = await processWarmupSendRound();

    const failedEvents = await prisma.warmupEvent.count({
      where: { senderMailboxId: a.id, status: "failed" },
    });
    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: a.id } });
    assert.ok(result.failed > 0);
    assert.ok(failedEvents > 0, "SMTP-ошибка должна сохраниться как WarmupEvent.failed");
    assert.equal(after.connState, "auth_error");
    assert.ok(after.connError, "причина ошибки должна быть видна в кабинете");
    smtp.failAuth = false;
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
