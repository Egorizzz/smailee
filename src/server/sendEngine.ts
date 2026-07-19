
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { sendViaMailbox } from "@/lib/mail/transport";
import { renderSpintax } from "@/lib/uniqueness/spintax";
import { config } from "@/lib/config";
import type { Mailbox, DomainGroup } from "@prisma/client";

/**
 * Движок оркестрации отправки (модель C, ТЗ §5.3).
 *
 * Кампания раскидывается ПО ПУЛУ ящиков клиента (не через единый канал):
 *   - ≤30 холодных писем/день на ЯЩИК (Mailbox.coldDailyLimit)
 *   - ≤120 писем/день на ДОМЕН (DomainGroup.dailyLimit)
 *   - ротация персон/доменов (round-robin, не «сначала весь один ящик»)
 *   - каждое письмо — через SMTP конкретного ящика, проходит через движок
 *     уникальности (§5.9) перед отправкой
 *   - упёрлись в лимит → письма остаются PENDING (resumable, следующий тик/день)
 *   - счётчик прогрева (warmupSentToday/warmupState) НЕ трогаем — отдельный
 *     путь, движок прогрева — M4.
 *
 * НЕ импортирует "server-only": вызывается из standalone-воркера (npm run
 * worker) вне Next-рантайма.
 */

const APP_URL = config.appUrl;
const THROTTLE_MS = config.send.throttleMs;
const BATCH_SIZE = config.send.batchSize;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isSameDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return a.toDateString() === b.toDateString();
}

function unsubscribeUrl(messageId: string) {
  return `${APP_URL}/unsubscribe/${messageId}`;
}

// Вставляет пиксель открытия и оборачивает ссылки в трекинг-редирект.
function instrumentHtml(html: string, messageId: string): string {
  let out = html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (_m, url) =>
      `href="${APP_URL}/api/track/click/${messageId}?url=${encodeURIComponent(url)}"`
  );
  const pixel = `<img src="${APP_URL}/api/track/open/${messageId}" width="1" height="1" style="display:none" alt="">`;
  if (out.includes("</body>")) out = out.replace("</body>", `${pixel}</body>`);
  else out += pixel;
  return out;
}

type PoolMailbox = Mailbox & { domainGroup: DomainGroup };

/**
 * Пригодные для отправки ящики клиента: не в явной ошибке auth/unreachable И
 * прогреты полные 14 дней (ТЗ §5.6: «кампанию нельзя стартовать, пока ящики
 * не прогреты»). Ящик, ещё не дошедший до warmupState=warm, физически не
 * попадает в пул холодной рассылки — гейт действует не только при запуске
 * кампании, но постоянно (напр. ящик добавили в пул кампании на середине ramp).
 */
async function loadUsableMailboxes(userId: string): Promise<PoolMailbox[]> {
  const today = new Date();
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId, connState: { in: ["ok", "paused"] }, warmupState: "warm" },
    include: { domainGroup: true },
  });

  const resetDomains = new Set<string>();
  for (const m of mailboxes) {
    if (!isSameDay(m.coldSentDate, today)) {
      await prisma.mailbox.update({
        where: { id: m.id },
        data: { coldSentToday: 0, coldSentDate: today },
      });
      m.coldSentToday = 0;
    }
    if (!resetDomains.has(m.domainGroupId) && !isSameDay(m.domainGroup.sentTodayDate, today)) {
      resetDomains.add(m.domainGroupId);
      await prisma.domainGroup.update({
        where: { id: m.domainGroupId },
        data: { sentToday: 0, sentTodayDate: today },
      });
    }
  }
  // применяем сброс к уже загруженным in-memory объектам (несколько ящиков
  // могут указывать на один и тот же домен — сброс делаем один раз на домен)
  for (const m of mailboxes) {
    if (resetDomains.has(m.domainGroupId)) m.domainGroup.sentToday = 0;
  }
  return mailboxes;
}

// Ротация персон/доменов: round-robin сначала по доменам, внутри — по ящикам,
// чтобы соседние отправки шли вперемешку, а не «сначала весь один ящик».
function buildRotation(mailboxes: PoolMailbox[]): PoolMailbox[] {
  const byDomain = new Map<string, PoolMailbox[]>();
  for (const m of mailboxes) {
    const arr = byDomain.get(m.domainGroupId) ?? [];
    arr.push(m);
    byDomain.set(m.domainGroupId, arr);
  }
  const queues = Array.from(byDomain.values());
  const rotation: PoolMailbox[] = [];
  let remaining = mailboxes.length;
  let i = 0;
  while (remaining > 0) {
    const q = queues[i % queues.length];
    if (q.length > 0) {
      rotation.push(q.shift()!);
      remaining--;
    }
    i++;
  }
  return rotation;
}

export async function processCampaign(campaignId: string): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
}> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { user: true },
  });
  if (!campaign) return { sent: 0, failed: 0, skipped: 0, remaining: 0 };

  // отложенный запуск ещё не наступил
  if (campaign.scheduledAt && campaign.scheduledAt > new Date()) {
    return { sent: 0, failed: 0, skipped: 0, remaining: 0 };
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "SENDING", startedAt: campaign.startedAt ?? new Date() },
  });

  const queue = await prisma.message.findMany({
    where: { campaignId, status: "PENDING" },
    include: { contact: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  // suppression-список пользователя
  const suppressed = new Set(
    (
      await prisma.suppression.findMany({
        where: { userId: campaign.userId },
        select: { email: true },
      })
    ).map((s) => s.email.toLowerCase())
  );

  const mailboxPool = await loadUsableMailboxes(campaign.userId);

  // ── Закрепление ящика за перепиской (непрерывность треда) ──
  // Ротация пула назначает ящик на КАЖДОЕ письмо независимо. Для follow-up
  // это ломало тред: контакт получал «Re:» с адреса, с которого ему никогда
  // не писали (а исходное письмо ушло с другого) — выглядит как спуфинг и
  // рвёт цепочку в почтовом клиенте. Поэтому: кто написал контакту первым,
  // тот пишет ему и дальше.
  const stickyByContact = new Map<string, string>();
  if (queue.length > 0) {
    // Рамки — ОДНА кампания: follow-up обязан уйти с того же адреса, что и
    // исходное письмо. Через кампании не закрепляем намеренно: иначе контакты,
    // которым первым написал ящик №1, навсегда осели бы на нём, он упирался бы
    // в свои 30/день, а остальные ящики простаивали.
    const prior = await prisma.message.findMany({
      where: {
        campaignId,
        contactId: { in: queue.map((m) => m.contactId) },
        mailboxId: { not: null },
      },
      orderBy: { sentAt: "asc" },
      select: { contactId: true, mailboxId: true },
    });
    for (const p of prior) {
      if (!stickyByContact.has(p.contactId)) stickyByContact.set(p.contactId, p.mailboxId!);
    }
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  if (mailboxPool.length > 0 && queue.length > 0) {
    // квоты ведём в памяти через Map (не через вложенный domainGroup-объект —
    // у каждого Mailbox своя JS-копия domainGroup, мутация не расшарится
    // между ящиками одного домена без явной общей карты)
    const mailboxRemaining = new Map<string, number>();
    const domainRemaining = new Map<string, number>();
    for (const m of mailboxPool) {
      mailboxRemaining.set(m.id, m.coldDailyLimit - m.coldSentToday);
      if (!domainRemaining.has(m.domainGroupId)) {
        domainRemaining.set(m.domainGroupId, m.domainGroup.dailyLimit - m.domainGroup.sentToday);
      }
    }

    const rotation = buildRotation(mailboxPool);
    let rotationIdx = 0;

    while (queue.length > 0 && rotation.length > 0) {
      const msg = queue[0];

      // не слать: suppression / невалидные / отписанные / bounced
      if (suppressed.has(msg.contact.email.toLowerCase()) || msg.contact.status !== "ACTIVE") {
        await prisma.message.update({
          where: { id: msg.id },
          data: { status: "FAILED", error: "suppressed / not active" },
        });
        skipped++;
        queue.shift();
        continue;
      }

      // ящик, который уже писал этому контакту, — если он всё ещё в пуле
      const stickyId = stickyByContact.get(msg.contactId);
      const sticky = stickyId ? rotation.find((m) => m.id === stickyId) : undefined;

      if (stickyId && !sticky && mailboxPool.some((m) => m.id === stickyId)) {
        // ящик в пуле, но выбыл из ротации = его дневная квота исчерпана.
        // Ждём завтра: писать «Re:» с чужого адреса хуже, чем отправить позже.
        queue.shift();
        continue;
      }

      const idx = sticky ? rotation.indexOf(sticky) : rotationIdx % rotation.length;
      const mailbox = rotation[idx];
      const mbRem = mailboxRemaining.get(mailbox.id)!;
      const domRem = domainRemaining.get(mailbox.domainGroupId)!;

      if (mbRem <= 0 || domRem <= 0) {
        // слот исчерпан на сегодня — выбывает из ротации, письмо остаётся в очереди
        rotation.splice(idx, 1);
        continue;
      }

      const vars = {
        name: msg.contact.name,
        company: msg.contact.company,
        email: msg.contact.email,
        unsubscribe_url: unsubscribeUrl(msg.id),
        cta_url: campaign.user.websiteUrl ?? APP_URL,
      };

      // движок уникальности (§5.9): spintax-альтернативы + переменные,
      // детерминированно по seed = id письма (subject/body — разные ветки)
      const subject = renderSpintax(msg.subject, vars, msg.id);
      let bodyRendered = renderSpintax(msg.body, vars, `${msg.id}:body`);
      if (msg.isHtml) {
        bodyRendered = instrumentHtml(bodyRendered, msg.id);
      } else {
        bodyRendered += `\n\n—\nОтписаться от рассылки: ${vars.unsubscribe_url}`;
      }

      const smtpPassword = decryptSecret(mailbox.smtpPasswordEnc);
      const result = await sendViaMailbox(mailbox, smtpPassword, {
        to: msg.contact.email,
        toName: msg.contact.name,
        subject,
        html: msg.isHtml ? bodyRendered : undefined,
        text: msg.isHtml ? undefined : bodyRendered,
        replyTo: mailbox.email,
        headers: {
          "List-Unsubscribe": `<${vars.unsubscribe_url}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      if (result.ok) {
        await prisma.message.update({
          where: { id: msg.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            providerMessageId: result.messageId,
            messageIdHeader: result.messageId,
            mailboxId: mailbox.id,
          },
        });
        await prisma.mailbox.update({
          where: { id: mailbox.id },
          data: {
            coldSentToday: { increment: 1 },
            // первая реальная успешная отправка подтверждает логин ящика
            ...(mailbox.connState !== "ok" ? { connState: "ok", connError: null } : {}),
          },
        });
        await prisma.domainGroup.update({
          where: { id: mailbox.domainGroupId },
          data: { sentToday: { increment: 1 } },
        });
        mailboxRemaining.set(mailbox.id, mbRem - 1);
        domainRemaining.set(mailbox.domainGroupId, domRem - 1);
        // с этого момента переписку с контактом ведёт этот ящик — в т.ч. если
        // follow-up к нему попадёт в этот же батч
        if (!stickyByContact.has(msg.contactId)) stickyByContact.set(msg.contactId, mailbox.id);
        sent++;
        rotationIdx++;
      } else {
        await prisma.message.update({
          where: { id: msg.id },
          data: { status: "FAILED", error: result.error, mailboxId: mailbox.id },
        });
        if (result.kind === "auth" || result.kind === "network") {
          await prisma.mailbox.update({
            where: { id: mailbox.id },
            data: {
              connState: result.kind === "auth" ? "auth_error" : "unreachable",
              connError: result.error,
            },
          });
          rotation.splice(idx, 1);
          // слот выбыл, но письмо уже помечено FAILED (не блокируем очередь) —
          // переходим к следующему сообщению на оставшихся ящиках
        }
        failed++;
        rotationIdx++;
      }

      queue.shift();
      await sleep(THROTTLE_MS);
    }
  }

  const remaining = await prisma.message.count({
    where: { campaignId, status: "PENDING" },
  });

  if (remaining === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "SENT" },
    });
  }

  return { sent, failed, skipped, remaining };
}

/**
 * Follow-up: для писем без ответа спустя followupDays создаёт письмо step=1.
 * Вызывается воркером периодически. Не завязан на конкретный ящик — новое
 * Message уходит в общую очередь PENDING, ящик ему назначит processCampaign.
 */
export async function processFollowups(campaignId: string): Promise<number> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign || !campaign.followupEnabled) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - campaign.followupDays);

  // письма step=0, отправленные раньше cutoff, без ответа и без follow-up
  const candidates = await prisma.message.findMany({
    where: {
      campaignId,
      step: 0,
      repliedAt: null,
      followupSentAt: null,
      sentAt: { lte: cutoff },
      status: { in: ["SENT", "DELIVERED", "OPENED"] },
    },
    take: 100,
  });

  let created = 0;
  for (const m of candidates) {
    await prisma.message.create({
      data: {
        campaignId,
        contactId: m.contactId,
        subject: campaign.followupSubject || `Re: ${m.subject}`,
        body: campaign.followupBody || "Здравствуйте! Хотел уточнить, актуально ли ещё моё предложение?",
        isHtml: false,
        step: 1,
        status: "PENDING",
      },
    });
    await prisma.message.update({
      where: { id: m.id },
      data: { followupSentAt: new Date() },
    });
    created++;
  }
  return created;
}
