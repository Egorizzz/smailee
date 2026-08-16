import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { isWithinSendWindow, nextSendWindowTime, type SendWindow } from "@/lib/schedule";
import { isConversationFrozen } from "@/lib/inboxState";
import { getBusinessContext } from "@/lib/businessProfile/context";
import { generateReply, LlmUnavailableError } from "@/lib/services/llm";
import { isPlanActive } from "@/lib/plans";
import { approveAndSendReply } from "./inboundEngine";
import { composeAiWritingInstructions } from "@/lib/aiWritingInstructions";

const RETRY_DELAY_MS = 15 * 60_000;
const REVIEW_LEAD_MS = 60 * 60_000;
const BATCH_SIZE = 100;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

/**
 * Автопинг двухфазный: сначала ИИ создаёт видимый в Inbox черновик с датой,
 * затем воркер отправляет именно сохранённый текст. Поэтому ручная правка не
 * теряется при наступлении времени отправки.
 */
export async function processAutoPings(
  now = new Date(),
  sendWindow: SendWindow = config.sendWindow,
): Promise<{ checked: number; drafted: number; sent: number; failed: number }> {
  const candidates = await prisma.message.findMany({
    where: {
      refusedAt: null,
      refusalSuggestedAt: null,
      autoPingStoppedAt: null,
      aiRepliesEnabled: true,
      mailboxId: { not: null },
      contact: { status: "ACTIVE" },
      thread: { some: { direction: "inbound" } },
      AND: [
        { OR: [
          { autoPingEnabled: true },
          { autoPingEnabled: null, campaign: { user: { autoPingEnabled: true } } },
        ] },
        { OR: [
          { thread: { none: { kind: "AUTO_PING", status: "DRAFT" } } },
          {
            autoPingNextAt: { lte: now },
            thread: { some: { kind: "AUTO_PING", status: "DRAFT" } },
          },
        ] },
      ],
    },
    include: {
      contact: true,
      mailbox: true,
      campaign: { include: { user: true } },
      lead: true,
      thread: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ autoPingNextAt: "asc" }, { createdAt: "asc" }],
    take: BATCH_SIZE,
  });

  let drafted = 0;
  let sent = 0;
  let failed = 0;

  for (const message of candidates) {
    const user = message.campaign.user;
    const enabled = message.autoPingEnabled ?? user.autoPingEnabled;
    const intervalDays = message.autoPingIntervalDays ?? user.autoPingIntervalDays;
    const maxAttempts = message.autoPingMaxAttempts ?? user.autoPingMaxAttempts;
    if (!enabled || message.autoPingAttempts >= maxAttempts || !isPlanActive(user.plan, user.planExpiresAt, now)) continue;

    const pendingDraft = message.thread.find((item) => item.kind === "AUTO_PING" && item.status === "DRAFT");

    if (pendingDraft) {
      if (!message.autoPingNextAt || message.autoPingNextAt > now || !isWithinSendWindow(now, sendWindow)) continue;

      const claimedUntil = new Date(now.getTime() + RETRY_DELAY_MS);
      const claimed = await prisma.message.updateMany({
        where: {
          id: message.id,
          refusedAt: null,
          refusalSuggestedAt: null,
          autoPingStoppedAt: null,
          autoPingAttempts: message.autoPingAttempts,
          autoPingNextAt: { lte: now },
        },
        data: { autoPingNextAt: claimedUntil },
      });
      if (claimed.count !== 1) continue;

      const currentState = await prisma.message.findUnique({
        where: { id: message.id },
        include: { lead: true, contact: true, thread: { orderBy: { createdAt: "asc" } } },
      });
      const currentDraft = currentState?.thread.find((item) => item.id === pendingDraft.id && item.kind === "AUTO_PING" && item.status === "DRAFT");
      if (!currentState || !currentDraft || !isConversationFrozen(currentState, now, user.autoPingStartAfterDays)) {
        await prisma.$transaction([
          prisma.replyMessage.deleteMany({ where: { id: pendingDraft.id, status: "DRAFT", kind: "AUTO_PING" } }),
          prisma.message.updateMany({ where: { id: message.id, autoPingNextAt: claimedUntil }, data: { autoPingNextAt: null } }),
        ]);
        continue;
      }

      try {
        const delivery = await approveAndSendReply(currentDraft.id, now);
        if (!delivery.ok) throw new Error(delivery.error ?? "SMTP rejected auto-ping");

        const attempts = message.autoPingAttempts + 1;
        await prisma.message.update({
          where: { id: message.id },
          data: {
            autoPingAttempts: attempts,
            autoPingLastSentAt: now,
            autoPingNextAt: attempts >= maxAttempts ? null : nextSendWindowTime(addDays(now, intervalDays), sendWindow),
            autoPingStoppedAt: attempts >= maxAttempts ? now : null,
          },
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        await prisma.message.updateMany({
          where: { id: message.id, refusedAt: null, autoPingStoppedAt: null },
          data: { autoPingNextAt: new Date(now.getTime() + RETRY_DELAY_MS) },
        });
        console.error(`[auto-ping] message ${message.id}: ${String(error)}`);
      }
      continue;
    }

    const plannedAt = nextSendWindowTime(
      message.autoPingNextAt && message.autoPingNextAt > now
        ? message.autoPingNextAt
        : new Date(now.getTime() + REVIEW_LEAD_MS),
      sendWindow,
    );
    if (!isConversationFrozen(message, plannedAt, user.autoPingStartAfterDays)) continue;

    const claimedUntil = new Date(now.getTime() + RETRY_DELAY_MS);
    const claimed = await prisma.message.updateMany({
      where: {
        id: message.id,
        refusedAt: null,
        refusalSuggestedAt: null,
        autoPingStoppedAt: null,
        autoPingAttempts: message.autoPingAttempts,
        thread: { none: { kind: "AUTO_PING", status: "DRAFT" } },
      },
      data: { autoPingNextAt: claimedUntil },
    });
    if (claimed.count !== 1) continue;

    try {
      const currentState = await prisma.message.findUnique({
        where: { id: message.id },
        include: { lead: true, thread: { orderBy: { createdAt: "asc" } } },
      });
      if (!currentState || !isConversationFrozen(currentState, plannedAt, user.autoPingStartAfterDays)) {
        await prisma.message.updateMany({ where: { id: message.id, autoPingNextAt: claimedUntil }, data: { autoPingNextAt: null } });
        continue;
      }

      const latestInbound = [...currentState.thread].reverse().find((item) => item.direction === "inbound")?.body ?? "";
      const business = await getBusinessContext(user, latestInbound);
      const thread = currentState.thread
        .filter((item) => item.status !== "DRAFT")
        .map((item) => ({ direction: item.direction, body: item.body }));
      const result = await generateReply({
        offer: business.offer,
        businessContext: business.promptContext,
        thread,
        funnelPrompt: [
          composeAiWritingInstructions({ dialogStylePrompt: user.dialogStylePrompt, additionalInstructions: user.funnelPrompt }),
          "Это автоматический пинг после паузы в диалоге. Напиши короткое нейтральное продолжение на 1–2 предложения.",
          "Не придумывай цены, договорённости и новые факты. Мягко вернись к последнему предметному вопросу и задай не больше одного простого вопроса.",
        ].filter(Boolean).join("\n\n"),
      });

      const beforeCreate = await prisma.message.findUnique({
        where: { id: message.id },
        include: { lead: true, thread: { orderBy: { createdAt: "asc" } } },
      });
      if (!beforeCreate || !isConversationFrozen(beforeCreate, plannedAt, user.autoPingStartAfterDays)) {
        await prisma.message.updateMany({ where: { id: message.id, autoPingNextAt: claimedUntil }, data: { autoPingNextAt: null } });
        continue;
      }

      await prisma.$transaction([
        prisma.replyMessage.create({
          data: {
            messageId: message.id,
            direction: "outbound",
            subject: `Re: ${message.subject}`,
            fromEmail: message.mailbox!.email,
            toEmail: message.contact.email,
            body: result.data,
            isAi: true,
            kind: "AUTO_PING",
            scheduledAt: plannedAt,
            status: "DRAFT",
          },
        }),
        prisma.message.update({ where: { id: message.id }, data: { autoPingNextAt: plannedAt } }),
      ]);
      drafted += 1;
    } catch (error) {
      failed += 1;
      await prisma.message.updateMany({
        where: { id: message.id, refusedAt: null, autoPingStoppedAt: null },
        data: { autoPingNextAt: new Date(now.getTime() + RETRY_DELAY_MS) },
      });
      const reason = error instanceof LlmUnavailableError ? "AI unavailable" : String(error);
      console.error(`[auto-ping] draft for message ${message.id}: ${reason}`);
    }
  }

  return { checked: candidates.length, drafted, sent, failed };
}
