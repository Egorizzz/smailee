import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { sendViaMailbox } from "@/lib/mail/transport";
import { markSeen, flagImportant, rescueWarmupFromSpam } from "@/lib/mail/imap";
import { embedWarmupMarker, extractWarmupCode } from "@/lib/mail/warmupDetector";
import { pickOpener, pickResponse, pickContinuation } from "@/lib/warmup/corpus";
import { makeRng, randInt, shuffle } from "@/lib/rng";
import { config } from "@/lib/config";
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
 */

const RAMP_DAYS = config.warmup.rampDays;

function isSameDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return a.toDateString() === b.toDateString();
}

function dayNumber(startedAt: Date, now: Date): number {
  const diffMs = now.getTime() - startedAt.getTime();
  return Math.max(1, Math.floor(diffMs / 86_400_000) + 1);
}

/**
 * Ramp (§5.6): день 1 ~2-4 письма, +2-4/день, к дню 14 ~20-30/день, дальше
 * поддержка на том же уровне — счётчик НИКОГДА не уходит в 0/выключается.
 * Детерминировано на день (не на каждый тик пересчитывается заново случайно).
 */
function warmupDailyTarget(mailboxId: string, day: number): number {
  const rng = makeRng(`warmup-ramp:${mailboxId}:${day}`);
  if (day >= RAMP_DAYS) return randInt(rng, 20, 30); // поддержка
  const base = 2 + (day - 1) * 2;
  return Math.min(30, randInt(rng, base, base + 2));
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
  });
}

/**
 * Ротируемый разнообразный выбор пиров (§5.6): seed-ящики + ящики других
 * клиентов + свои соседи, исключая недавних партнёров этого ящика (последние
 * 15 писем), чтобы не переписываться с одними и теми же снова и снова.
 */
async function pickWarmupPeers(
  sender: Candidate,
  pool: Candidate[],
  count: number
): Promise<Candidate[]> {
  if (count <= 0) return [];
  const recent = await prisma.warmupEvent.findMany({
    where: { senderMailboxId: sender.id },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { recipientMailboxId: true },
  });
  const excluded = new Set(recent.map((r) => r.recipientMailboxId));
  excluded.add(sender.id);

  const candidates = pool.filter((m) => !excluded.has(m.id) && (m.isSeed || m.warmupState !== "off"));
  if (candidates.length === 0) return [];

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
 */
export async function processWarmupSendRound(): Promise<{ sent: number; failed: number }> {
  const pool = await loadWarmupPool();
  const today = new Date();
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
    if (day !== mailbox.warmupDay || (day >= RAMP_DAYS && mailbox.warmupState !== "warm")) {
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: { warmupDay: day, ...(day >= RAMP_DAYS ? { warmupState: "warm" } : {}) },
      });
      mailbox.warmupDay = day;
      if (day >= RAMP_DAYS) mailbox.warmupState = "warm";
    }

    const target = warmupDailyTarget(mailbox.id, day);
    const remaining = target - mailbox.warmupSentToday;
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
export async function processWarmupEngagement(): Promise<{ read: number; replied: number; flagged: number }> {
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
    const willReply = rng() < replyChance && event.hop < config.warmup.maxHops;

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
            },
          });
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
