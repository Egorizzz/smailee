import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { sendViaMailbox } from "@/lib/mail/transport";
import { markSeen, flagImportant, rescueWarmupFromSpam } from "@/lib/mail/imap";
import { embedWarmupMarker, extractWarmupCode } from "@/lib/mail/warmupDetector";
import { pickOpener, pickResponse, pickContinuation } from "@/lib/warmup/corpus";
import { makeRng, shuffle } from "@/lib/rng";
import { config } from "@/lib/config";
import {
  TRIGGA_RULES,
  triggaWarmupDailyTarget,
  triggaWarmupRequiredBeforeCampaign,
} from "@/lib/mail/triggaRules";
import { isWithinSendWindow, sendWindowProgress, type SendWindow } from "@/lib/schedule";
import type { Mailbox } from "@prisma/client";

/**
 * Движок прогрева (ТЗ §5.6, M4). Три независимых прохода, вызываемых
 * воркером на каждом тике:
 *
 *   processWarmupSendRound()  — по ramp-графику рассылает письма пирам
 *   processWarmupEngagement() — "принимающая сторона": прочитано/ответ/важное
 *   processWarmupSpamRescue() — вытаскивает прогрев, залетевший в Спам
 *
 * Кросс-клиентский пиринг: пул кандидатов НЕ фильтруется по userId — ящики
 * всех клиентов с прогревом + наши seed-ящики переписываются между собой.
 * Никаких вызовов ИИ — контент только из handwritten-корпуса (§5.9.3) +
 * spintax. НЕ импортирует "server-only" (standalone-воркер вне Next).
 *
 * processWarmupSendRound шлёт только в рабочее окно (§5.3, config.sendWindow,
 * по умолчанию Пн-Пт 9:00-19:00 МСК) и размазывает дневную квоту по этому
 * окну (unlockedWarmupTarget), а не высылает её разом при открытии — см.
 * src/lib/schedule.ts. processWarmupEngagement/processWarmupSpamRescue окном
 * не ограничены: они не отправляют новый прогревочный трафик, только читают
 * IMAP и реагируют на уже доставленное — это не создаёт паттерн подозрительной
 * активности, в отличие от исходящей отправки.
 */

const RAMP_DAYS = TRIGGA_RULES.warmup.daysBeforeCampaign;
const REQUIRED_WARMUP_SENDS = triggaWarmupRequiredBeforeCampaign();

function isSameDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return a.toDateString() === b.toDateString();
}

function dayNumber(startedAt: Date, now: Date): number {
  const diffMs = now.getTime() - startedAt.getTime();
  // длительность «дня» ramp конфигурируема (config.warmup.dayMs): боевой дефолт
  // — реальные сутки; в тест-режиме сжимается (напр. 1 мин), чтобы прогнать
  // весь цикл за часы, а не за 14 дней. См. src/lib/config.ts.
  return Math.max(1, Math.floor(diffMs / config.warmup.dayMs) + 1);
}

/**
 * Ramp (§5.6, по базе знаний Trigga): день 1 — config.warmup.dailyStart писем,
 * дальше +dailyIncrement/день до потолка dailyMax, на нём и остаётся —
 * счётчик НИКОГДА не уходит в 0/выключается. С дефолтами (2, +1, потолок 10)
 * это день 1 → 2 письма, день 9 → 10, дальше стабильные ~10/день.
 *
 * Именно медленный прирост (не более +1-2/день) — это то, что отличает
 * прогрев от подозрительной активности в глазах провайдера: резкий скачок
 * объёма с нового ящика выглядит как спам-атака, даже если весь трафик
 * легитимный.
 *
 * Детерминировано на день (не на каждый тик пересчитывается заново случайно).
 * Лёгкая вариативность ±1 на потолке — чтобы объём не был идеально ровным
 * изо дня в день, это тоже сигнал "живого" ящика, а не бота по расписанию.
 */
export function warmupDailyTarget(mailboxId: string, day: number): number {
  void mailboxId;
  return triggaWarmupDailyTarget(day);
}

/**
 * Сколько из дневной цели уже разрешено выслать к текущему моменту окна.
 *
 * Без этого весь дневной таргет открывался бы разом в момент открытия окна
 * (или сразу на первом тике после сброса счётчика) — 10 писем улетали бы
 * одним залпом за ~5 секунд, что не менее подозрительно для провайдера, чем
 * прежний залп в 3 ночи, просто в другое время суток. round вверх (не вниз):
 * при округлении вниз последнее письмо дня разблокировалось бы ровно в
 * момент закрытия окна и почти никогда не успевало уйти.
 */
export function unlockedWarmupTarget(target: number, windowProgress: number): number {
  return Math.min(target, Math.ceil(target * windowProgress));
}

type Candidate = Pick<
  Mailbox,
  | "id"
  | "email"
  | "senderName"
  | "userId"
  | "isSeed"
  | "connState"
  | "warmupState"
  | "warmupStartedAt"
  | "warmupSentToday"
  | "warmupSentDate"
  | "warmupDay"
  | "smtpHost"
  | "smtpPort"
  | "smtpSecurity"
  | "smtpLogin"
  | "smtpPasswordEnc"
>;

/**
 * Пул ящиков, участвующих в прогреве (отправители и потенциальные пиры):
 * прогреваемые/тёплые ЛЮБОГО клиента + наши seed-ящики. Ящики в явной ошибке
 * подключения исключены (как и в M2/M3-пуле).
 */
async function loadWarmupPool(): Promise<Candidate[]> {
  return prisma.mailbox.findMany({
    where: {
      connState: { in: ["ok", "paused"] },
      OR: [{ isSeed: true }, { warmupState: { in: ["warming", "warm"] } }, { warmupState: "off" }],
    },
    // Стабильный порядок: выбор пиров тасует этот список seeded-RNG, а значит
    // при плавающем порядке строк «детерминированный» выбор перестаёт быть
    // детерминированным (тот же seed — другой результат).
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Ротируемый разнообразный выбор пиров (§5.6): seed-ящики + ящики других
 * клиентов + свои соседи, по возможности исключая недавних партнёров этого
 * ящика, чтобы не переписываться с одними и теми же снова и снова.
 *
 * Окно исключения адаптивно к размеру сети. Раньше оно было жёстко «последние
 * 15 писем», и это намертво вешало прогрев в любой сети меньше ~16 ящиков:
 * у ящика всего (N-1) возможных партнёров, а чтобы партнёр вышел из окна,
 * нужно 15 более свежих писем ДРУГИМ партнёрам. При N<16 после первых же
 * (N-1) отправок все кандидаты оказывались исключены — и НАВСЕГДА, т.к.
 * вытеснить их из окна больше некем. Ящик замолкал, отправив 1-3 письма, и
 * никогда не доходил до warm (симптом: день 79/14, а статус всё ещё warming).
 */
async function pickWarmupPeers(
  sender: Candidate,
  pool: Candidate[],
  count: number
): Promise<Candidate[]> {
  if (count <= 0) return [];

  const eligible = pool.filter((m) => m.id !== sender.id && (m.isSeed || m.warmupState !== "off"));
  if (eligible.length === 0) return [];

  // Исключаем не больше, чем (число партнёров - 1): хотя бы один кандидат
  // обязан остаться. При 2 ящиках окно = 0 (пишем единственному соседу),
  // при 3 — 1 (чередуем), при 16+ — прежние 15.
  const windowSize = Math.min(15, eligible.length - 1);
  const recent =
    windowSize > 0
      ? await prisma.warmupEvent.findMany({
          where: { senderMailboxId: sender.id },
          orderBy: { createdAt: "desc" },
          take: windowSize,
          select: { recipientMailboxId: true },
        })
      : [];
  const excluded = new Set(recent.map((r) => r.recipientMailboxId));

  const fresh = eligible.filter((m) => !excluded.has(m.id));
  // Подстраховка: разнообразие пиров вторично по отношению к тому, чтобы
  // прогрев вообще шёл — если исключили всех, шлём кому есть.
  const candidates = fresh.length > 0 ? fresh : eligible;

  const rng = makeRng(`warmup-peers:${sender.id}:${new Date().toDateString()}:${sender.warmupSentToday}`);
  const shuffled = shuffle(rng, candidates);
  const seeds = shuffled.filter((m) => m.isSeed);
  const others = shuffled.filter((m) => !m.isSeed);

  const result: Candidate[] = [];
  if (seeds.length > 0) result.push(seeds[0]); // разнообразие: хотя бы один seed, если есть
  for (const m of others) {
    if (result.length >= count) break;
    result.push(m);
  }
  return result.slice(0, count);
}

/**
 * Рассылка по ramp-графику. Для ящиков с warmupState="off" (только что
 * подключены, не seed) — автозапуск прогрева: он "никогда не выключается"
 * (§5.6), поэтому не требует отдельного шага оператора.
 *
 * `now` и `sendWindow` инжектируются (по умолчанию — реальное время и
 * config.sendWindow) ради тестируемости окна отправки без мока глобального
 * Date и без мутации общего конфига между тестами: тесты передают конкретный
 * момент времени и/или своё окно и проверяют, шлёт движок или нет.
 */
export async function processWarmupSendRound(
  now: Date = new Date(),
  sendWindow: SendWindow = config.sendWindow
): Promise<{ sent: number; failed: number }> {
  // Вне рабочего окна не шлём вообще — ни писем, ни даже не трогаем БД.
  // Причина, зачем это понадобилось, и её связь со сбросом счётчика по UTC —
  // в комментарии src/lib/schedule.ts.
  if (!isWithinSendWindow(now, sendWindow)) return { sent: 0, failed: 0 };

  const pool = await loadWarmupPool();
  const today = now;
  const windowProgress = sendWindowProgress(now, sendWindow);
  let sent = 0;
  let failed = 0;

  for (const mailbox of pool) {
    if (mailbox.isSeed) continue; // seed-ящики отвечают/принимают, но не "прогреваются" сами

    if (mailbox.warmupState === "off") {
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: { warmupState: "warming", warmupStartedAt: today, warmupDay: 1 },
      });
      mailbox.warmupState = "warming";
      mailbox.warmupStartedAt = today;
      mailbox.warmupDay = 1;
    }
    if (!mailbox.warmupStartedAt) continue;

    if (!isSameDay(mailbox.warmupSentDate, today)) {
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: { warmupSentToday: 0, warmupSentDate: today },
      });
      mailbox.warmupSentToday = 0;
    }

    const day = dayNumber(mailbox.warmupStartedAt, today);
    if (day !== mailbox.warmupDay) {
      await prisma.mailbox.update({ where: { id: mailbox.id }, data: { warmupDay: day } });
      mailbox.warmupDay = day;
    }

    // Переход в "warm" — не только по календарю: ящик мог всё это время
    // сидеть без пира. Требуем реальную отправку в каждый из 14 дней ramp.
    // Объём дня при этом уже жёстко ограничен графиком 2, +1/день, max 10.
    // Пока порог не набран, ящик остаётся warming и не проходит гейт кампании.
    if (day >= RAMP_DAYS && mailbox.warmupState !== "warm") {
      const totalSent = await prisma.warmupEvent.count({
        where: { senderMailboxId: mailbox.id, status: { not: "failed" } },
      });
      const activeWarmupDays = await prisma.warmupEvent.findMany({
        where: { senderMailboxId: mailbox.id, status: { not: "failed" } },
        select: { createdAt: true },
      });
      const distinctDays = new Set(activeWarmupDays.map((event) => event.createdAt.toDateString()));
      if (totalSent >= REQUIRED_WARMUP_SENDS && distinctDays.size >= RAMP_DAYS) {
        await prisma.mailbox.update({ where: { id: mailbox.id }, data: { warmupState: "warm" } });
        mailbox.warmupState = "warm";
      }
    }

    const target = warmupDailyTarget(mailbox.id, day);
    const unlocked = unlockedWarmupTarget(target, windowProgress);
    const remaining = unlocked - mailbox.warmupSentToday;
    if (remaining <= 0) continue;

    const peers = await pickWarmupPeers(mailbox, pool, remaining);
    if (peers.length === 0) continue;

    const smtpPassword = decryptSecret(mailbox.smtpPasswordEnc);
    for (const peer of peers) {
      const seed = `warmup-send:${mailbox.id}:${peer.id}:${Date.now()}`;
      const { node: openerNode, rendered } = pickOpener(seed);
      const code = `${mailbox.id.slice(-6)}${peer.id.slice(-6)}${Math.random().toString(36).slice(2, 8)}`;
      const html = `<div>${rendered.body.replace(/\n/g, "<br>")}</div>${embedWarmupMarker(code)}`;

      const result = await sendViaMailbox(mailbox, smtpPassword, {
        to: peer.email,
        subject: rendered.subject ?? "Привет",
        html,
      });

      if (result.ok) {
        await prisma.warmupEvent.create({
          data: {
            senderMailboxId: mailbox.id,
            recipientMailboxId: peer.id,
            code,
            subject: rendered.subject ?? "",
            status: "sent",
            messageIdHeader: result.messageId,
            corpusNodeId: openerNode.id, // нужен, чтобы ответ выбрал дочерний узел корпуса
            hop: 0,
            createdAt: now,
          },
        });
        await prisma.mailbox.update({
          where: { id: mailbox.id },
          data: { warmupSentToday: { increment: 1 } },
        });
        mailbox.warmupSentToday++;
        sent++;
      } else {
        console.error(`[warmupEngine] send failed ${mailbox.email} -> ${peer.email}:`, result.error);
        if (result.kind === "auth" || result.kind === "network") {
          // тот же паттерн, что и в sendEngine (§5.3) — реальный сигнал для
          // мониторинга здоровья флота (§5.8, M5), не только консоль
          await prisma.mailbox.update({
            where: { id: mailbox.id },
            data: {
              connState: result.kind === "auth" ? "auth_error" : "unreachable",
              connError: result.error,
            },
          });
        }
        failed++;
      }
      await new Promise((r) => setTimeout(r, config.warmup.throttleMs));
    }
  }

  return { sent, failed };
}

/**
 * "Принимающая сторона" (§5.6): мы владеем IMAP обоих концов, поэтому вместо
 * ожидания реального человека сами читаем/отвечаем/помечаем важным. Действует
 * на события, доставленные в INBOX (напрямую или после спасения из спама) и
 * ещё не помеченные прочитанными.
 */
export async function processWarmupEngagement(
  now: Date = new Date(),
  sendWindow: SendWindow = config.sendWindow
): Promise<{ read: number; replied: number; flagged: number }> {
  // Ответ — тоже исходящее прогревочное письмо. Вне рабочего окна откладываем
  // весь event до следующего прохода, иначе seenAt лишит его будущего ответа.
  if (!isWithinSendWindow(now, sendWindow)) return { read: 0, replied: 0, flagged: 0 };

  const events = await prisma.warmupEvent.findMany({
    where: {
      seenAt: null,
      OR: [{ deliveredAt: { not: null } }, { rescuedAt: { not: null } }],
      recipientUid: { not: null },
    },
    include: { recipientMailbox: true, senderMailbox: true },
    take: 25,
  });

  let read = 0;
  let replied = 0;
  let flagged = 0;
  const windowProgress = sendWindowProgress(now, sendWindow);
  const sentByMailbox = new Map<string, number>();

  for (const event of events) {
    const recipient = event.recipientMailbox;
    if (recipient.connState === "auth_error" || recipient.connState === "unreachable") continue;
    if (!event.recipientUid) continue;

    const imapPassword = decryptSecret(recipient.imapPasswordEnc);
    const seenOk = await markSeen(recipient, imapPassword, event.recipientUid);
    if (seenOk) read++;

    const rng = makeRng(`warmup-engage:${event.code}`);
    const doFlag = rng() < config.warmup.flagImportantProbability;
    if (doFlag) {
      const ok = await flagImportant(recipient, imapPassword, event.recipientUid);
      if (ok) flagged++;
    }

    const replyChance = config.warmup.replyProbabilityMin + rng() * (config.warmup.replyProbabilityMax - config.warmup.replyProbabilityMin);
    let sentToday = sentByMailbox.get(recipient.id) ?? recipient.warmupSentToday;
    if (!isSameDay(recipient.warmupSentDate, now)) {
      await prisma.mailbox.update({
        where: { id: recipient.id },
        data: { warmupSentToday: 0, warmupSentDate: now },
      });
      sentToday = 0;
      recipient.warmupSentToday = 0;
      recipient.warmupSentDate = now;
    }
    sentByMailbox.set(recipient.id, sentToday);

    const recipientDay = recipient.warmupStartedAt
      ? dayNumber(recipient.warmupStartedAt, now)
      : RAMP_DAYS;
    const replyTarget = unlockedWarmupTarget(
      warmupDailyTarget(recipient.id, recipientDay),
      windowProgress
    );
    const hasReplyBudget = sentToday < replyTarget;
    const willReply =
      hasReplyBudget &&
      rng() < replyChance &&
      event.hop < config.warmup.maxHops;

    let newStatus: "opened" | "replied" = "opened";
    if (willReply && event.corpusNodeId) {
      const seedBase = `warmup-send:${event.senderMailboxId}:${event.recipientMailboxId}:${event.code}`;
      const picked =
        event.hop === 0
          ? pickResponse(event.corpusNodeId, seedBase)
          : pickContinuation(event.corpusNodeId, seedBase);
      if (picked) {
        const smtpPassword = decryptSecret(recipient.smtpPasswordEnc);
        const replyCode = `${event.code}-r${event.hop + 1}`;
        const html = `<div>${picked.rendered.body.replace(/\n/g, "<br>")}</div>${embedWarmupMarker(replyCode)}`;
        const sendResult = await sendViaMailbox(recipient, smtpPassword, {
          to: event.senderMailbox.email,
          subject: `Re: ${event.subject}`,
          html,
          inReplyTo: event.messageIdHeader ?? undefined,
          references: event.messageIdHeader ?? undefined,
        });
        if (sendResult.ok) {
          await prisma.warmupEvent.create({
            data: {
              senderMailboxId: event.recipientMailboxId,
              recipientMailboxId: event.senderMailboxId,
              code: replyCode,
              subject: `Re: ${event.subject}`,
              status: "sent",
              messageIdHeader: sendResult.messageId,
              repliedToCode: event.code,
              corpusNodeId: picked.node.id,
              hop: event.hop + 1,
              createdAt: now,
            },
          });
          await prisma.mailbox.update({
            where: { id: recipient.id },
            data: { warmupSentToday: { increment: 1 } },
          });
          recipient.warmupSentToday++;
          sentByMailbox.set(recipient.id, sentToday + 1);
          replied++;
          newStatus = "replied";
        }
      }
    }

    await prisma.warmupEvent.update({
      where: { id: event.id },
      data: {
        seenAt: new Date(),
        status: newStatus,
        ...(newStatus === "replied" ? { respondedAt: new Date() } : {}),
      },
    });
  }

  return { read, replied, flagged };
}

/** Спасение прогревочных писем, залетевших в Спам (§5.6). */
export async function processWarmupSpamRescue(): Promise<{ rescued: number }> {
  const mailboxes = await prisma.mailbox.findMany({
    where: {
      connState: { in: ["ok", "paused"] },
      OR: [{ isSeed: true }, { warmupState: { in: ["warming", "warm"] } }],
    },
  });

  let rescued = 0;
  for (const mailbox of mailboxes) {
    const imapPassword = decryptSecret(mailbox.imapPasswordEnc);
    const result = await rescueWarmupFromSpam(mailbox, imapPassword, extractWarmupCode);
    if (!result.ok || result.rescued.length === 0) continue;

    for (const item of result.rescued) {
      await prisma.warmupEvent
        .update({
          where: { code: item.code },
          data: { status: "rescued_from_spam", rescuedAt: new Date(), recipientUid: item.uid, deliveredAt: new Date() },
        })
        .catch(() => {});
    }
    rescued += result.rescued.length;
  }

  return { rescued };
}
