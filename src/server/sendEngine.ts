
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { sendViaMailbox } from "@/lib/mail/transport";
import { renderSpintax } from "@/lib/uniqueness/spintax";
import { tidyAfterSubstitution } from "@/lib/mail/placeholders";
import { plainTextToHtml } from "@/lib/mail/textToHtml";
import { config } from "@/lib/config";
import { DELIVERABILITY_RULES } from "@/lib/mail/deliverabilityRules";
import { isWithinSendWindow, type SendWindow } from "@/lib/schedule";
import { isPlanActive, limitsFor } from "@/lib/plans";
import { emailQuotaMonthStart, getEmailQuotaUsage } from "@/server/limits";
import type { CampaignStatus, Mailbox, DomainGroup } from "@prisma/client";

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
 *   - шлём только в рабочее окно (§5.3, config.sendWindow, по умолчанию
 *     Пн-Пт 9:00-19:00 МСК) — вне него письма остаются PENDING без изменений.
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

// PENDING+QUEUED: письмо в QUEUED держит либо этот же вызов (до захвата
// партии), либо параллельный проход — в обоих случаях оно ещё не отработано.
function pendingCount(campaignId: string): Promise<number> {
  return prisma.message.count({ where: { campaignId, status: { in: ["PENDING", "QUEUED"] } } });
}

async function markWaitingCampaignQueued(campaignId: string, status: CampaignStatus): Promise<void> {
  if (status !== "SENDING") return;
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "QUEUED" } });
}

// Вставляет пиксель открытия в минимальную HTML-альтернативу письма.
function appendOpenPixel(html: string, messageId: string): string {
  const pixel = `<img src="${APP_URL}/api/track/open/${messageId}" width="1" height="1" style="display:none" alt="">`;
  if (html.includes("</body>")) return html.replace("</body>", `${pixel}</body>`);
  return html + pixel;
}

type PoolMailbox = Mailbox & { domainGroup: DomainGroup };

/**
 * Пригодные для отправки ящики клиента: не в явной ошибке auth/unreachable И
 * прогреты полные 14 дней (ТЗ §5.6: «кампанию нельзя стартовать, пока ящики
 * не прогреты»). Ящик, ещё не дошедший до warmupState=warm, физически не
 * попадает в пул холодной рассылки — гейт действует не только при запуске
 * кампании, но постоянно (напр. ящик добавили в пул кампании на середине ramp).
 */
async function loadUsableMailboxes(userId: string, today: Date): Promise<PoolMailbox[]> {
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId, connState: { in: ["ok", "paused"] }, warmupState: "warm" },
    include: { domainGroup: true },
    // Порядок обязателен: на нём строится round-robin (buildRotation), а без
    // orderBy Postgres отдаёт строки в физическом порядке кучи — любой UPDATE
    // ящика (смена connState, счётчик отправок) перебрасывает его в конец, и
    // «ротация персон/доменов» из §5.3 тасуется произвольно от тика к тику.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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

/**
 * `now` и `sendWindow` инжектируются (по умолчанию — реальное время и
 * config.sendWindow) ради тестируемости окна отправки (§5.3) без мока
 * глобального Date и без мутации общего конфига между тестами.
 */
export async function processCampaign(
  campaignId: string,
  now: Date = new Date(),
  sendWindow: SendWindow = config.sendWindow
): Promise<{
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
  // Жёсткая граница песочницы: даже при ручной подмене статуса или прямом
  // вызове движка демо-кампания не дойдёт до выбора SMTP-ящика.
  if (campaign.isDemo) return { sent: 0, failed: 0, skipped: 0, remaining: 0 };

  // Просроченный демо/платный план не имеет фонового обходного пути: даже
  // ранее поставленная очередь останавливается непосредственно в движке.
  // Статус очереди сохраняем: после оплаты/продления она продолжится сама.
  if (!isPlanActive(campaign.user.plan, campaign.user.planExpiresAt, now)) {
    await markWaitingCampaignQueued(campaignId, campaign.status);
    return { sent: 0, failed: 0, skipped: 0, remaining: await pendingCount(campaignId) };
  }

  // Месячная квота проверяется и при создании кампании, и здесь. Runtime-гейт
  // обязателен для уже поставленных очередей и follow-up: новый месяц, смена
  // тарифа или параллельные кампании не должны позволять фактической отправке
  // выйти за лимит плана.
  const planQuota = await getEmailQuotaUsage(campaign.user, now);
  if (planQuota.remaining <= 0) {
    await markWaitingCampaignQueued(campaignId, campaign.status);
    return { sent: 0, failed: 0, skipped: 0, remaining: await pendingCount(campaignId) };
  }

  // отложенный запуск ещё не наступил
  if (campaign.scheduledAt && campaign.scheduledAt > now) {
    await markWaitingCampaignQueued(campaignId, campaign.status);
    return { sent: 0, failed: 0, skipped: 0, remaining: await pendingCount(campaignId) };
  }

  // Вне рабочего окна не шлём вообще. Частично отправлённую кампанию возвращаем
  // из SENDING в QUEUED: она уже не отправляется, а ждёт следующего окна.
  // Раньше отправка не учитывала время суток вообще — воркер добивал очередь
  // в любой час, включая ночь. См. src/lib/schedule.ts.
  //
  // remaining считаем честно (не 0): письма никуда не делись, они просто
  // ждут следующего окна — вызывающий код (worker.ts) логирует это число, и
  // враньё «ничего не осталось» скрыло бы, что кампания на самом деле стоит.
  if (!isWithinSendWindow(now, sendWindow)) {
    await markWaitingCampaignQueued(campaignId, campaign.status);
    return { sent: 0, failed: 0, skipped: 0, remaining: await pendingCount(campaignId) };
  }

  // ── Захват партии писем ──
  // Без него письма уходили ДВАЖДЫ: launchCampaign отправляет синхронно в
  // веб-процессе, а воркер параллельно забирает ту же кампанию по статусу
  // QUEUED/SENDING (worker.ts) — оба прохода читали ОДИН список PENDING и
  // отправляли его каждый по разу. Реальный инцидент 2026-07-31: получатели
  // мультисегментной пачки получили по два одинаковых письма.
  //
  // Один атомарный UPDATE ... RETURNING переводит партию PENDING → QUEUED,
  // поэтому каждый проход работает только со своей частью. SKIP LOCKED — чтобы
  // параллельный проход не ждал чужую блокировку, а сразу взял другие строки.
  // MessageStatus.QUEUED до этого не использовался: он занят только у кампаний.
  const claimed = await prisma.$transaction(async (tx) => {
    // Сериализуем резерв месячной квоты на владельца. Уже захваченные другим
    // процессом QUEUED-письма считаются in-flight, поэтому два параллельных
    // запуска не резервируют один и тот же последний слот тарифа.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${campaign.userId}))`;
    const [sentThisMonth, inFlight] = await Promise.all([
      tx.message.count({
        where: { campaign: { userId: campaign.userId }, sentAt: { gte: emailQuotaMonthStart(now) } },
      }),
      tx.message.count({
        where: { campaign: { userId: campaign.userId }, status: "QUEUED" },
      }),
    ]);
    const monthlyLimit = limitsFor(campaign.user.plan, campaign.user.planExpiresAt).maxEmailsPerMonth;
    const claimLimit = Math.min(BATCH_SIZE, Math.max(0, monthlyLimit - sentThisMonth - inFlight));
    if (claimLimit <= 0) return [];

    return tx.$queryRaw<{ id: string }[]>`
      UPDATE "Message" SET status = 'QUEUED'
      WHERE id IN (
        SELECT id FROM "Message"
        WHERE "campaignId" = ${campaignId} AND status = 'PENDING'
        ORDER BY "createdAt" ASC
        LIMIT ${claimLimit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;
  });
  const claimedIds = claimed.map((c) => c.id);

  if (claimedIds.length > 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "SENDING", startedAt: campaign.startedAt ?? now },
    });
  }

  const queue =
    claimedIds.length === 0
      ? []
      : await prisma.message.findMany({
          where: { id: { in: claimedIds } },
          include: { contact: true },
          orderBy: { createdAt: "asc" },
        });

  // suppression-список пользователя (releasedAt: null — вернутые оператором
  // вручную контакты снова доступны для отправки)
  const suppressed = new Set(
    (
      await prisma.suppression.findMany({
        where: { userId: campaign.userId, releasedAt: null },
        select: { email: true },
      })
    ).map((s) => s.email.toLowerCase())
  );

  const mailboxPool = await loadUsableMailboxes(campaign.userId, now);

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

  try {
  if (mailboxPool.length > 0 && queue.length > 0) {
    // квоты ведём в памяти через Map (не через вложенный domainGroup-объект —
    // у каждого Mailbox своя JS-копия domainGroup, мутация не расшарится
    // между ящиками одного домена без явной общей карты)
    const mailboxRemaining = new Map<string, number>();
    const domainRemaining = new Map<string, number>();
    for (const m of mailboxPool) {
      mailboxRemaining.set(
        m.id,
        Math.min(m.coldDailyLimit, DELIVERABILITY_RULES.coldPerMailboxDailyMax) - m.coldSentToday
      );
      if (!domainRemaining.has(m.domainGroupId)) {
        domainRemaining.set(
          m.domainGroupId,
          Math.min(m.domainGroup.dailyLimit, DELIVERABILITY_RULES.coldPerDomainDailyMax) -
            m.domainGroup.sentToday
        );
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
        cta_url: campaign.user.websiteUrl ?? APP_URL,
      };

      // движок уникальности (§5.9): spintax-альтернативы + переменные,
      // детерминированно по seed = id письма (subject/body — разные ветки)
      // tidyAfterSubstitution — уборка следов пустой переменной: у контакта
      // может не быть имени, тогда на месте {{name}} остаётся пустота и текст
      // превращается в «Здравствуйте, !». Делаем это до добавления пикселя
      // открытия, чтобы не трогать сформированный MIME-контент.
      const subject = tidyAfterSubstitution(renderSpintax(msg.subject, vars, msg.id));
      let bodyRendered = tidyAfterSubstitution(renderSpintax(msg.body, vars, `${msg.id}:body`));
      // ── Трекинг и формат письма ──
      // Пиксель открытия и подмена ссылок работают только в HTML. Поэтому от
      // переключателя зависит не только аналитика, но и сам формат письма:
      //
      //   трекинг ВЫКЛ (по умолчанию) — текстовое письмо уходит чистым
      //     text/plain. Это лучший вариант по доставляемости: холодное письмо
      //     выглядит как личное, а не как рассылка;
      //   трекинг ВКЛ — текстовое письмо уходит как multipart/alternative:
      //     чистый текст плюс HTML-двойник, который и несёт пиксель со
      //     ссылками. HTML-часть нужна ИСКЛЮЧИТЕЛЬНО ради трекинга, поэтому
      //     без него её не добавляем — лишняя часть только вредит.
      const tracking = campaign.trackingEnabled;
      let htmlBody: string | undefined;
      let textBody: string | undefined;

      if (msg.isHtml) {
        htmlBody = tracking ? appendOpenPixel(bodyRendered, msg.id) : bodyRendered;
      } else {
        textBody = bodyRendered;
        htmlBody = tracking ? appendOpenPixel(plainTextToHtml(bodyRendered), msg.id) : undefined;
      }

      // Ни ссылки, ни заголовка List-Unsubscribe (§«отписка», см.
      // inboundEngine.ts) — модель Smailee строится на переписке
      // человек-человеку, отказ определяется по прямой просьбе в ответе,
      // а не по формальному механизму отписки, который выдаёт письмо за
      // массовую рассылку. Проверено перед решением: список рассылки —
      // требование Gmail/Yahoo только при 5000+ писем/день на Gmail-адреса,
      // у нас на порядок меньше; для холодной персональной переписки
      // практика cold-email считает его чужеродным, а не полезным сигналом.
      const smtpPassword = decryptSecret(mailbox.smtpPasswordEnc);
      const result = await sendViaMailbox(mailbox, smtpPassword, {
        to: msg.contact.email,
        toName: msg.contact.name,
        subject,
        html: htmlBody,
        text: textBody,
        replyTo: mailbox.email,
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
  } finally {
    // Возвращаем в очередь всё захваченное, но не доведённое до SENT/FAILED:
    // упёрлись в дневную квоту, ждём освобождения sticky-ящика, кончились
    // ящики в ротации, свалились с исключением. Без этого письма застряли бы
    // в QUEUED навсегда — их бы уже никто не подобрал.
    if (claimedIds.length > 0) {
      await prisma.message.updateMany({
        where: { id: { in: claimedIds }, status: "QUEUED" },
        data: { status: "PENDING" },
      });
    }
  }

  // Считаем и QUEUED тоже: их держит параллельный проход, кампания ещё не
  // отработана, и помечать её SENT рано.
  const remaining = await pendingCount(campaignId);

  if (remaining === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "SENT" },
    });
  } else if (sent === 0 && claimedIds.length > 0) {
    // «Отправляется» означает реальную отправку, а не безрезультатную попытку.
    // Если ящиков/дневной ёмкости не хватило, возвращаем честный статус
    // «В очереди» — карточка кампании расшифрует конкретную причину ожидания.
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "QUEUED" },
    });
  }

  return { sent, failed, skipped, remaining };
}

/**
 * Follow-up: настраиваемая цепочка писем без ответа (§5.3): 3-4 письма,
 * у каждого свой интервал.
 * Вызывается воркером периодически. Не завязан на конкретный ящик — новое
 * Message уходит в общую очередь PENDING, ящик ему назначит processCampaign.
 *
 * Шаги идут СТРОГО по порядку: шаг N создаётся из письма step=N-1, и только
 * если оно уже отправлено, без ответа и без ранее созданного из него шага
 * (followupSentAt). За один проход письмо продвигается максимум на один шаг —
 * воркер тикает часто, так что цепочка догонит себя за несколько тиков.
 * daysAfterPrevious отсчитывается от sentAt ИМЕННО предыдущего шага, не от
 * исходного письма — интервалы в цепочке независимы друг от друга.
 */
export async function processFollowups(campaignId: string): Promise<number> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { user: true, followupSteps: { orderBy: { stepNumber: "asc" } } },
  });
  if (!campaign || campaign.isDemo || !campaign.followupEnabled || !isPlanActive(campaign.user.plan, campaign.user.planExpiresAt)) return 0;

  let created = 0;
  for (const step of campaign.followupSteps) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - step.daysAfterPrevious);

    // письма предыдущего шага, отправленные раньше cutoff, без ответа и без
    // уже созданного из них следующего шага
    const candidates = await prisma.message.findMany({
      where: {
        campaignId,
        step: step.stepNumber - 1,
        repliedAt: null,
        followupSentAt: null,
        sentAt: { lte: cutoff },
        status: { in: ["SENT", "DELIVERED", "OPENED"] },
      },
      take: 100,
    });

    for (const m of candidates) {
      await prisma.message.create({
        data: {
          campaignId,
          contactId: m.contactId,
          subject: step.subject,
          body: step.body,
          isHtml: false,
          step: step.stepNumber,
          status: "PENDING",
        },
      });
      await prisma.message.update({
        where: { id: m.id },
        data: { followupSentAt: new Date() },
      });
      created++;
    }
  }
  return created;
}
