
import { prisma } from "@/lib/prisma";
import { generateReply, qualifyLead } from "@/lib/services/llm";
import { pushLead } from "@/lib/services/bitrix";
import { notifyOwnerOfHotLead } from "./notifications";
import { decryptSecret } from "@/lib/crypto";
import { sendViaMailbox } from "@/lib/mail/transport";
import { pollMailboxInbox, type FetchedEmail } from "@/lib/mail/imap";
import { extractWarmupCode } from "@/lib/mail/warmupDetector";
import { config } from "@/lib/config";
import type { Mailbox } from "@prisma/client";

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
async function matchIncomingToMessage(userId: string, email: FetchedEmail) {
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
};

/**
 * Обработка одного входящего ответа. Вызывается и из IMAP-поллинга
 * (pollInboundMailboxes), и вручную — «Симулировать ответ» в карточке
 * кампании (без реального инбокса, для проверки сценария).
 *
 * Шаги: сохранить входящее → AI пишет ответ → AI квалифицирует → если
 * модерация выключена и есть ящик — реально отправить ответ через SMTP того
 * же ящика → если HOT — CRM + уведомление.
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

  // 1. Сохраняем входящее (как письмо в треде)
  await prisma.replyMessage.create({
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
    data: { status: "REPLIED", repliedAt: message.repliedAt ?? new Date() },
  });
  await prisma.event.create({
    data: { messageId: message.id, type: "reply" },
  });

  // Собираем тред для AI
  const thread = [
    ...message.thread.map((t) => ({ direction: t.direction, body: t.body })),
    { direction: "inbound", body: input.inboundBody },
  ];

  // 2. AI генерирует ответ
  const { data: replyBody } = await generateReply({
    offer: message.campaign.user.offer ?? "Наш продукт",
    thread,
  });

  // 3. AI квалифицирует лида
  const {
    data: { qualification, summary },
  } = await qualifyLead({ thread });

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

  // 4. AI квалифицирует → создаём/обновляем лид
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

  // 5. Тёплый лид → передаём в CRM (Битрикс24) + уведомляем владельца кабинета
  if (qualification === "HOT" && !lead.pushedToCrm) {
    const res = await pushLead({
      title: `Smailee: тёплый лид ${message.contact.company ?? message.contact.email}`,
      name: message.contact.name,
      email: message.contact.email,
      comment: summary,
    });
    if (res.ok) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { pushedToCrm: true },
      });
    }
    await notifyOwnerOfHotLead({
      userId: message.campaign.userId,
      contactEmail: message.contact.email,
      contactName: message.contact.name,
      summary,
    });
  }

  return { alreadyProcessed: false, replyBody, qualification, moderated };
}

/** Одобрить черновик ответа ИИ и реально отправить его (режим модерации, §5.5). */
export async function approveAndSendReply(
  replyMessageId: string
): Promise<{ ok: boolean; error?: string }> {
  const reply = await prisma.replyMessage.findUnique({
    where: { id: replyMessageId },
    include: { message: { include: { contact: true, mailbox: true } } },
  });
  if (!reply) return { ok: false, error: "Черновик не найден" };
  if (reply.direction !== "outbound") return { ok: false, error: "Это не исходящее письмо" };
  if (reply.status === "SENT") return { ok: true };
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

  await prisma.replyMessage.update({
    where: { id: reply.id },
    data: { status: "SENT", providerMessageId: result.messageId },
  });
  return { ok: true };
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

    const maxUid = result.emails.length > 0 ? Math.max(...result.emails.map((e) => e.uid)) : mailbox.imapLastUid;
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        lastCheckedAt: new Date(),
        imapUidValidity: result.uidValidity,
        imapLastUid: result.reset ? result.uidNext - 1 : maxUid,
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
