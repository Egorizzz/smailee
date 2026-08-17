
import { prisma } from "@/lib/prisma";
import { generateReply, LlmUnavailableError, qualifyLead } from "@/lib/services/llm";
import { pushLead } from "@/lib/services/bitrix";
import { enqueueCustomerReplyNotification } from "./customerNotifications";
import { decryptSecret } from "@/lib/crypto";
import { sendViaMailbox } from "@/lib/mail/transport";
import { pollMailboxInbox, type FetchedEmail } from "@/lib/mail/imap";
import { extractWarmupCode } from "@/lib/mail/warmupDetector";
import { buildHandoffContext, MANUAL_TRIGGER_KEY } from "@/lib/crm/handoffTriggers";
import { config } from "@/lib/config";
import { nextSendWindowTime } from "@/lib/schedule";
import type { LeadQualification, Mailbox } from "@prisma/client";
import { getBusinessContext } from "@/lib/businessProfile/context";
import { composeAiWritingInstructions } from "@/lib/aiWritingInstructions";

/**
 * Приём ответов (IMAP-поллинг, ТЗ §5.4) + ИИ-диалог и квалификация (§5.5).
 *
 * НЕ импортирует "server-only": вызывается из standalone-воркера (npm run
 * worker) вне Next-рантайма. Расшифровка IMAP/SMTP-доступов — только здесь,
 * на момент вызова (§8.2).
 */

function normalizeMsgId(id: string): string {
  return id.trim().replace(/^<|>$/g, "");
}

/**
 * Привязка входящего письма к исходному Message (§4.3, §5.4): по In-Reply-To,
 * затем по References, затем — фолбэком — по email отправителя (последнее
 * отправленное этому контакту письмо в аккаунте).
 */
export async function matchIncomingToMessage(userId: string, email: FetchedEmail) {
  const candidates = [
    email.inReplyTo ? normalizeMsgId(email.inReplyTo) : null,
    ...email.references.map(normalizeMsgId),
  ].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    const msg = await prisma.message.findFirst({
      where: {
        campaign: { userId },
        OR: [{ messageIdHeader: candidate }, { messageIdHeader: `<${candidate}>` }],
      },
    });
    if (msg) return msg;
  }

  if (email.fromEmail) {
    const msg = await prisma.message.findFirst({
      where: {
        campaign: { userId },
        contact: { email: email.fromEmail.toLowerCase() },
        status: { in: ["SENT", "DELIVERED", "OPENED", "CLICKED", "REPLIED"] },
      },
      orderBy: { sentAt: "desc" },
    });
    if (msg) return msg;
  }

  return null;
}

/** Отправляет AI-ответ через тот же ящик, что и исходное письмо (непрерывность треда). */
async function sendAiReplyViaMailbox(
  message: { subject: string; messageIdHeader: string | null; contact: { email: string; name: string | null } },
  mailbox: Mailbox,
  replyBody: string,
  inReplyToExternalId?: string | null
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const smtpPassword = decryptSecret(mailbox.smtpPasswordEnc);
  const references = [message.messageIdHeader, inReplyToExternalId].filter(Boolean).join(" ") || undefined;
  const result = await sendViaMailbox(mailbox, smtpPassword, {
    to: message.contact.email,
    toName: message.contact.name,
    subject: `Re: ${message.subject}`,
    text: replyBody,
    inReplyTo: inReplyToExternalId ?? undefined,
    references,
  });
  if (result.ok) return { ok: true, messageId: result.messageId };
  return { ok: false, error: result.error };
}

export type InboundReplyResult = {
  alreadyProcessed: boolean;
  replyBody: string | null;
  qualification: string | null;
  /** true = ответ ИИ сгенерирован, но НЕ отправлен — ждёт одобрения оператора. */
  moderated: boolean;
  /**
   * true = лид уже передан в CRM, линия закрыта: входящее зафиксировано в
   * треде, но ИИ намеренно НЕ отвечает — дальше работает живой продавец.
   */
  handedOff?: boolean;
  /** true = общий AI API недоступен; входящее сохранено, автоответ не создавался. */
  aiUnavailable?: boolean;
  /** true = генерация ответов отключена пользователем именно для этого диалога. */
  aiDisabled?: boolean;
  /** true = ИИ предложил пометить диалог как коммерческий отказ. */
  declined?: boolean;
  /**
   * true = клиент прямо попросил прекратить писать. Контакт уже добавлен в
   * стоп-лист (Suppression) — ИИ намеренно НЕ отвечает: отвечать на "не
   * пишите мне" ещё одним письмом (даже вежливым) — плохая идея сама по себе.
   */
  optedOut?: boolean;
};

/**
 * Обработка одного входящего ответа. Вызывается и из IMAP-поллинга
 * (pollInboundMailboxes), и вручную — «Симулировать ответ» в карточке
 * кампании (без реального инбокса, для проверки сценария).
 *
 * Шаги: сохранить входящее → AI квалифицирует (и проверяет явный отказ) →
 * если отказ — стоп-лист и тишина, иначе AI пишет ответ → если модерация
 * выключена и есть ящик — реально отправить ответ через SMTP того же ящика →
 * если сработал триггер передачи — CRM + уведомление.
 */
export async function handleInboundReply(input: {
  messageId: string;
  inboundBody: string;
  externalMessageId?: string | null;
  inboundSubject?: string | null;
}): Promise<InboundReplyResult> {
  const message = await prisma.message.findUnique({
    where: { id: input.messageId },
    include: {
      contact: true,
      campaign: { include: { user: true } },
      mailbox: true,
      lead: true,
      thread: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!message) throw new Error("message not found");

  // идемпотентность: то же самое входящее письмо уже обработано (защита от
  // повторной обработки при рестарте воркера между fetch и сохранением UID)
  if (input.externalMessageId) {
    const dup = await prisma.replyMessage.findFirst({
      where: { messageId: message.id, externalMessageId: input.externalMessageId },
    });
    if (dup) {
      return { alreadyProcessed: true, replyBody: null, qualification: null, moderated: false };
    }
  }

  // Клиент уже ответил — запланированный автопинг больше не актуален и не
  // должен ни висеть в Inbox, ни уйти позже по старому расписанию.
  await prisma.replyMessage.deleteMany({
    where: { messageId: message.id, kind: "AUTO_PING", status: "DRAFT" },
  });

  // 1. Сохраняем входящее (как письмо в треде)
  const inboundReply = await prisma.replyMessage.create({
    data: {
      messageId: message.id,
      direction: "inbound",
      subject: input.inboundSubject ?? `Re: ${message.subject}`,
      fromEmail: message.contact.email,
      toEmail: message.mailbox?.email ?? "you@smailee.ru",
      body: input.inboundBody,
      externalMessageId: input.externalMessageId ?? null,
      status: "SENT", // это не наша отправка — просто зафиксировано
    },
  });
  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: "REPLIED",
      repliedAt: message.repliedAt ?? new Date(),
      ...(message.refusedAt || message.lead?.processedAt
        ? {}
        : {
            autoPingAttempts: 0,
            autoPingNextAt: null,
            autoPingLastSentAt: null,
            autoPingStoppedAt: null,
          }),
    },
  });
  await prisma.event.create({
    data: { messageId: message.id, type: "reply" },
  });

  const previousQualification = message.lead?.qualification ?? null;
  const finish = async (
    result: InboundReplyResult,
    actionRequired: boolean,
    currentQualification: LeadQualification | null = null,
  ) => {
    try {
      await enqueueCustomerReplyNotification({
        ownerId: message.campaign.userId,
        campaignCreatedById: message.campaign.createdById,
        sourceReplyId: inboundReply.id,
        previousQualification,
        currentQualification,
        actionRequired,
      });
    } catch (error) {
      // Уведомление не должно откатывать сохранённый ответ или ломать IMAP.
      // Очередь надёжна после создания строки; здесь возможна только ошибка
      // постановки, которую оставляем заметной в логах воркера.
      console.error(`[inbound] failed to enqueue customer notification for ${inboundReply.id}`, error);
    }
    return result;
  };

  // Собираем тред для AI
  const thread = [
    ...message.thread.map((t) => ({ direction: t.direction, body: t.body })),
    { direction: "inbound", body: input.inboundBody },
  ];

  if (message.refusedAt || message.lead?.processedAt) {
    return finish({
      alreadyProcessed: false,
      replyBody: null,
      qualification: message.lead?.qualification ?? "UNKNOWN",
      moderated: false,
      declined: Boolean(message.refusedAt),
    }, true, message.lead?.qualification ?? null);
  }

  // ЛИНИЯ ЗАКРЫТА: лид уже передан в CRM, дальше с клиентом работает живой
  // продавец. Входящее фиксируем в треде (выше), но ИИ молчит — иначе бот и
  // продавец пишут клиенту одновременно, наперегонки. Это худшее, что можно
  // сделать с тёплым лидом, поэтому выходим до генерации ответа.
  if (message.lead?.handedOffAt && message.lead.pushedToCrm && message.lead.crmEntityId) {
    return finish({
      alreadyProcessed: false,
      replyBody: null,
      qualification: message.lead.qualification,
      moderated: false,
      handedOff: true,
    }, true, message.lead.qualification);
  }

  const user = message.campaign.user;
  // Встроенные триггеры + свой сценарий одной строкой — оба источника разом,
  // иначе клиент, написавший свой сценарий, потерял бы встроенные и наоборот.
  const { promptText: triggersPrompt, validKeys: triggerKeys } = buildHandoffContext(
    user.crmHandoffTriggers,
    user.customHandoffPrompt
  );

  // 2. AI квалифицирует лида, ищет триггеры CRM и явный отказ (optOut) —
  // НАМЕРЕННО раньше генерации ответа (было наоборот). Если сразу писать
  // ответ, а квалифицировать после, при выключенной модерации отказавшемуся
  // контакту уйдёт ещё одно письмо ДО того, как мы узнаем об отказе.
  let qualification: "HOT" | "COLD" | "IRRELEVANT" | "UNKNOWN";
  let summary: string;
  let trigger: string | null;
  let optOut: boolean;
  let declined: boolean;
  let nextContactAt: string | null;
  try {
    ({ data: { qualification, summary, trigger, optOut, declined, nextContactAt } } = await qualifyLead({
      thread,
      triggersPrompt,
      triggerKeys,
      referenceDate: new Date().toISOString().slice(0, 10),
    }));
  } catch (error) {
    if (error instanceof LlmUnavailableError) {
      console.error("[inbound] AI unavailable; inbound reply was saved without an automatic reply", error);
      return finish({ alreadyProcessed: false, replyBody: null, qualification: "UNKNOWN" as const, moderated: false, aiUnavailable: true }, true, previousQualification);
    }
    throw error;
  }

  const parsedNextContactAt = nextContactAt
    ? new Date(`${nextContactAt}T09:00:00+03:00`)
    : null;
  const nextContactDate = parsedNextContactAt && !Number.isNaN(parsedNextContactAt.getTime())
    ? parsedNextContactAt
    : null;
  const detectedAt = new Date();

  await prisma.message.update({
    where: { id: message.id },
    data: {
      nextContactAt: nextContactDate,
      refusalSuggestedAt: declined || optOut ? detectedAt : null,
    },
  });

  // Квалификация и резюме продолжают обновляться даже в полностью ручном
  // диалоге: отключается только генерация текста ответа.
  const lead = await prisma.lead.upsert({
    where: { messageId: message.id },
    update: { qualification, summary },
    create: {
      userId: message.campaign.userId,
      messageId: message.id,
      qualification,
      summary,
    },
  });

  // Явный отказ («не пишите мне») — контакт в стоп-лист НАВСЕГДА (все будущие
  // кампании), ИИ молчит. Отвечать на просьбу прекратить писать ещё одним
  // письмом — плохая идея сама по себе, даже вежливым текстом.
  if (optOut) {
    await prisma.suppression.upsert({
      where: { userId_email: { userId: message.campaign.userId, email: message.contact.email } },
      update: { reason: "declined_via_reply", releasedAt: null },
      create: { userId: message.campaign.userId, email: message.contact.email, reason: "declined_via_reply" },
    });
    await prisma.contact.update({
      where: { id: message.contactId },
      data: { status: "UNSUBSCRIBED" },
    });
    await prisma.message.update({
      where: { id: message.id },
      data: {
        refusedAt: detectedAt,
        autoPingStoppedAt: detectedAt,
        autoPingNextAt: null,
      },
    });
    return finish({ alreadyProcessed: false, replyBody: null, qualification, moderated: false, optedOut: true }, false, qualification);
  }

  // Коммерческий отказ сначала подтверждает человек. До решения не создаём
  // лишний ответ и не ставим автопинг.
  if (declined) {
    return finish({ alreadyProcessed: false, replyBody: null, qualification, moderated: false, declined: true }, true, qualification);
  }

  if (!message.aiRepliesEnabled) {
    return finish({ alreadyProcessed: false, replyBody: null, qualification, moderated: false, aiDisabled: true }, true, qualification);
  }

  // 3. AI генерирует ответ
  let replyBody: string;
  try {
    const latestInbound = [...thread].reverse().find((item) => item.direction === "inbound")?.body ?? "";
    const business = await getBusinessContext(user, latestInbound);
    ({ data: replyBody } = await generateReply({
      offer: business.offer,
      businessContext: business.promptContext,
      thread,
      funnelPrompt: composeAiWritingInstructions({
        dialogStylePrompt: user.dialogStylePrompt,
        additionalInstructions: user.funnelPrompt,
      }),
    }));
  } catch (error) {
    if (error instanceof LlmUnavailableError) {
      console.error("[inbound] AI unavailable; no automatic reply was created", error);
      return finish({ alreadyProcessed: false, replyBody: null, qualification, moderated: false, aiUnavailable: true }, true, qualification);
    }
    throw error;
  }

  // Режим модерации (§5.5): ответ ИИ сохраняется черновиком, оператор
  // одобряет вручную (approveAndSendReply) — не отправляется автоматически.
  const moderationOn = message.campaign.user.aiModerationEnabled;

  const outboundReply = await prisma.replyMessage.create({
    data: {
      messageId: message.id,
      direction: "outbound",
      subject: `Re: ${message.subject}`,
      fromEmail: message.mailbox?.email ?? "you@smailee.ru",
      toEmail: message.contact.email,
      body: replyBody,
      isAi: true,
      status: "DRAFT",
    },
  });

  let moderated = moderationOn;
  if (!moderationOn) {
    if (message.mailbox) {
      const sendResult = await sendAiReplyViaMailbox(
        message,
        message.mailbox,
        replyBody,
        input.externalMessageId
      );
      if (sendResult.ok) {
        await prisma.replyMessage.update({
          where: { id: outboundReply.id },
          data: { status: "SENT", providerMessageId: sendResult.messageId },
        });
      } else {
        console.error(`[inboundEngine] AI reply send failed for message ${message.id}:`, sendResult.error);
        moderated = true; // не удалось отправить — остаётся черновиком, видно оператору
      }
    } else {
      // письмо ещё не уходило через ящик (напр. симуляция на несозданной рассылке) —
      // реальная отправка невозможна, черновик остаётся видимым оператору
      moderated = true;
    }
  }

  // 4. Создаём/обновляем лид по квалификации, полученной на шаге 2
  // 5. Пора ли отдавать лида живому продавцу.
  // Решает СРАБОТАВШИЙ ТРИГГЕР (наблюдаемое действие: попросил звонок,
  // предложил встречу), а не общая оценка «тёплый». saveCrmSettings не даёт
  // сохранить пустой список триггеров — иначе ИИ никогда не понял бы, когда
  // остановиться. Фолбэк на qualification === "HOT" остаётся только на
  // случай пустого/повреждённого значения в БД (защита, а не обычный путь).
  const shouldHandOff = triggerKeys.length > 0 ? Boolean(trigger) : qualification === "HOT";

  const confirmedInCrm = lead.pushedToCrm && Boolean(lead.crmEntityId);
  if (shouldHandOff && !confirmedInCrm) {
    const webhook = user.bitrixWebhookEnc ? decryptSecret(user.bitrixWebhookEnc) : null;

    if (webhook) {
      const res = await pushLead(webhook, {
        title: `Smailee: тёплый лид ${message.contact.company ?? message.contact.email}`,
        name: message.contact.name,
        email: message.contact.email,
        comment: summary,
        thread,
        fromMailbox: message.mailbox?.email ?? null,
      });
      if (res.ok) {
        // Линия закрывается ТОЛЬКО после подтверждённой передачи: иначе ИИ
        // замолчал бы, а лида в CRM нет — клиент остался бы без ответа вообще.
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            pushedToCrm: true,
            crmEntityId: res.crmId,
            handedOffAt: new Date(),
            handoffTrigger: trigger,
          },
        });
      } else {
        console.error(`[inboundEngine] передача лида в Битрикс24 не удалась: ${res.error}`);
      }
    } else {
      // Вебхука нет — передавать некуда. Раньше mock-режим возвращал успех и
      // лид помечался как переданный, хотя никуда не уходил; теперь честно
      // оставляем непереданным и уведомляем владельца, чтобы лид не потерялся.
      console.warn(
        `[inboundEngine] лид ${lead.id} готов к передаче, но Битрикс24 не подключён у клиента ${user.email}`
      );
    }

  }

  return finish({ alreadyProcessed: false, replyBody, qualification, moderated }, moderated, qualification);
}

/** Одобрить черновик ответа ИИ и реально отправить его (режим модерации, §5.5). */
export async function approveAndSendReply(
  replyMessageId: string,
  sentAt = new Date(),
): Promise<{ ok: boolean; error?: string }> {
  const reply = await prisma.replyMessage.findUnique({
    where: { id: replyMessageId },
    include: { message: { include: { contact: true, mailbox: true, lead: true, campaign: { include: { user: true } } } } },
  });
  if (!reply) return { ok: false, error: "Черновик не найден" };
  if (reply.direction !== "outbound") return { ok: false, error: "Это не исходящее письмо" };
  if (reply.status === "SENT") return { ok: true };
  if (reply.message.refusedAt || reply.message.contact.status !== "ACTIVE") {
    return { ok: false, error: "Коммуникация с контактом остановлена" };
  }
  if (reply.message.lead?.processedAt || reply.message.lead?.handedOffAt) {
    return { ok: false, error: "Диалог уже закрыт или передан менеджеру" };
  }
  if (!reply.message.mailbox) {
    return { ok: false, error: "У письма не назначен ящик отправки" };
  }

  const lastInbound = await prisma.replyMessage.findFirst({
    where: { messageId: reply.messageId, direction: "inbound" },
    orderBy: { createdAt: "desc" },
  });

  const result = await sendAiReplyViaMailbox(
    reply.message,
    reply.message.mailbox,
    reply.body,
    lastInbound?.externalMessageId
  );
  if (!result.ok) return { ok: false, error: result.error };

  const user = reply.message.campaign.user;
  const autoPingEnabled = reply.message.autoPingEnabled ?? user.autoPingEnabled;
  const shouldScheduleAutoPing = reply.kind === "REPLY"
    && autoPingEnabled
    && reply.message.aiRepliesEnabled
    && reply.message.contact.status === "ACTIVE"
    && !reply.message.refusedAt
    && !reply.message.lead?.processedAt
    && !reply.message.lead?.handedOffAt;
  await prisma.$transaction([
    prisma.replyMessage.update({
      where: { id: reply.id },
      data: { status: "SENT", providerMessageId: result.messageId, createdAt: sentAt },
    }),
    ...(shouldScheduleAutoPing ? [prisma.message.update({
      where: { id: reply.messageId },
      data: {
        autoPingAttempts: 0,
        autoPingLastSentAt: null,
        autoPingStoppedAt: null,
        autoPingNextAt: nextSendWindowTime(
          new Date(sentAt.getTime() + user.autoPingStartAfterDays * 24 * 60 * 60_000),
          config.sendWindow,
        ),
      },
    })] : []),
  ]);
  return { ok: true };
}

/**
 * Ручная передача лида в CRM — минуя ИИ-квалификацию полностью: оператор
 * решает сам, не дожидаясь срабатывания настроенных триггеров. Закрывает
 * линию так же, как автоматическая передача (§«интеграция с Битрикс24»):
 * дальше с клиентом работает продавец в CRM, ИИ по этому лиду больше не пишет.
 *
 * Ядро вынесено из "use server"-экшена (settings/crmActions.ts) по тому же
 * принципу, что и approveAndSendReply выше: requireUser() читает куки Next.js
 * и не работает вне реального запроса, а интеграционные тесты живут вне
 * Next-рантайма. Экшен — тонкая обёртка: резолвит пользователя и вызывает это.
 */
export async function pushLeadToCrm(
  leadId: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, userId },
    include: {
      message: {
        include: { contact: true, mailbox: true, thread: { orderBy: { createdAt: "asc" } } },
      },
      user: true,
    },
  });
  if (!lead) return { ok: false, error: "Лид не найден" };
  if (lead.pushedToCrm && lead.crmEntityId) {
    return { ok: false, error: "Этот лид уже передан в CRM" };
  }
  if (!lead.user.bitrixWebhookEnc) {
    return { ok: false, error: "Битрикс24 не подключён — сначала добавьте вебхук в настройках" };
  }

  const webhook = decryptSecret(lead.user.bitrixWebhookEnc);
  const thread = lead.message.thread.map((t) => ({ direction: t.direction, body: t.body }));

  const res = await pushLead(webhook, {
    title: `Smailee: лид ${lead.message.contact.company ?? lead.message.contact.email}`,
    name: lead.message.contact.name,
    email: lead.message.contact.email,
    comment: lead.summary,
    thread,
    fromMailbox: lead.message.mailbox?.email ?? null,
  });
  if (!res.ok) return { ok: false, error: `Битрикс24 отклонил передачу: ${res.error}` };

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      pushedToCrm: true,
      crmEntityId: res.crmId,
      handedOffAt: new Date(),
      handoffTrigger: MANUAL_TRIGGER_KEY,
    },
  });
  return { ok: true };
}

/**
 * Куда сдвинуть позицию поллинга (Mailbox.imapLastUid) после опроса.
 *
 * Вынесено отдельной чистой функцией не ради красоты: это самая опасная строчка
 * приёма. Ошибка здесь означает, что при первом подключении ящика (или после
 * смены UIDVALIDITY) вся его старая переписка будет поднята как «новые ответы» —
 * ИИ ответит на письма годичной давности всем подряд. Проверяемо без IMAP.
 */
export function nextImapPosition(input: {
  reset: boolean;
  uidNext: number;
  emails: { uid: number }[];
  currentLastUid: number;
}): number {
  // reset = первый опрос или сменилась UIDVALIDITY: только baseline на текущий
  // конец ящика, историю не трогаем
  if (input.reset) return input.uidNext - 1;
  if (input.emails.length === 0) return input.currentLastUid;
  return Math.max(...input.emails.map((e) => e.uid));
}

/**
 * IMAP-поллинг всех пригодных ящиков (§5.4). Вызывается воркером на каждом
 * тике; внутри — throttle НА ЯЩИК через Mailbox.lastCheckedAt (см.
 * config.inboundPollMs), поэтому реальный IMAP-запрос уходит не чаще, чем раз
 * в inboundPollMs на конкретный ящик, даже если тик воркера чаще.
 */
export async function pollInboundMailboxes(): Promise<{
  checked: number;
  newEmails: number;
  matched: number;
  warmup: number;
}> {
  const cutoff = new Date(Date.now() - config.inboundPollMs);
  const mailboxes = await prisma.mailbox.findMany({
    where: {
      connState: { in: ["ok", "paused"] },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: cutoff } }],
    },
  });

  let checked = 0;
  let newEmails = 0;
  let matched = 0;
  let warmup = 0;

  for (const mailbox of mailboxes) {
    checked++;
    const imapPassword = decryptSecret(mailbox.imapPasswordEnc);
    const result = await pollMailboxInbox(
      mailbox,
      imapPassword,
      mailbox.imapUidValidity,
      mailbox.imapLastUid
    );

    if (!result.ok) {
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: {
          lastCheckedAt: new Date(),
          connState: result.kind === "auth" ? "auth_error" : result.kind === "network" ? "unreachable" : mailbox.connState,
          connError: result.error,
        },
      });
      console.error(`[inboundEngine] poll failed for ${mailbox.email}:`, result.error);
      continue;
    }

    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        lastCheckedAt: new Date(),
        imapUidValidity: result.uidValidity,
        imapLastUid: nextImapPosition({
          reset: result.reset,
          uidNext: result.uidNext,
          emails: result.emails,
          currentLastUid: mailbox.imapLastUid,
        }),
        ...(mailbox.connState !== "ok" ? { connState: "ok", connError: null } : {}),
      },
    });

    // reset = первый опрос (или UIDVALIDITY сменилась) — только baseline,
    // старую переписку как новые ответы не поднимаем
    if (result.reset || result.emails.length === 0) continue;

    for (const email of result.emails) {
      newEmails++;

      // прогревочный трафик (§5.6) — по скрытому маркеру в теле, не заголовок.
      // Не создаём диалог/лид/AI-ответ: фиксируем доставку в WarmupEvent, а
      // реальные действия "принимающей стороны" (прочитано/ответ/важное)
      // выполняет отдельный проход warmupEngine.processWarmupEngagement().
      const warmupCode = extractWarmupCode(email);
      if (warmupCode) {
        warmup++;
        await prisma.warmupEvent
          .update({
            where: { code: warmupCode },
            data: {
              status: "delivered",
              deliveredAt: new Date(),
              recipientUid: email.uid,
            },
          })
          .catch((err) => {
            // событие не найдено (напр. код совпал случайно, либо БД гонка) —
            // не фатально, письмо и так уже исключено из реального инбокса
            console.warn(`[inboundEngine] warmup event ${warmupCode} not found:`, err);
          });
        continue;
      }

      const message = await matchIncomingToMessage(mailbox.userId, email);
      if (!message) {
        console.warn(
          `[inboundEngine] не удалось привязать письмо от ${email.fromEmail ?? "?"} (ящик ${mailbox.email}) к исходному Message`
        );
        continue;
      }

      const outcome = await handleInboundReply({
        messageId: message.id,
        inboundBody: email.text ?? email.html ?? "",
        externalMessageId: email.messageId,
        inboundSubject: email.subject,
      });
      if (!outcome.alreadyProcessed) matched++;
    }
  }

  return { checked, newEmails, matched, warmup };
}
