"use server";

import { revalidatePath } from "next/cache";
import { can, requireWorkspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { approveAndSendReply } from "@/server/inboundEngine";
import { config } from "@/lib/config";
import { nextSendWindowTime } from "@/lib/schedule";
import { isDemoWorkspaceActive } from "@/lib/demoWorkspace";

async function findOwnedMessage(messageId: string) {
  const workspace = await requireWorkspace();
  const canReplyAll = can(workspace, "LEADS_REPLY_ALL");
  const canReplyOwn = can(workspace, "LEADS_REPLY_OWN");
  if (!canReplyAll && !canReplyOwn) return { workspace, message: null };
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      campaign: {
        userId: workspace.owner.id,
        isDemo: demoActive,
        ...(canReplyAll ? {} : { createdById: workspace.actor.id }),
      },
    },
    include: { contact: true, mailbox: true, lead: true, thread: true, campaign: { select: { isDemo: true } } },
  });
  return { workspace, message };
}

function refreshInbox() {
  revalidatePath("/app/inbox");
  revalidatePath("/app/analytics");
  revalidatePath("/app", "layout");
}

export async function sendManualInboxReply(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const messageId = String(formData.get("messageId") || "");
  const body = String(formData.get("body") || "").trim();
  if (!body) return { error: "Введите текст ответа" };
  const { message } = await findOwnedMessage(messageId);
  if (!message) return { error: "Диалог не найден" };
  if (!message.thread.some((item) => item.direction === "inbound")) return { error: "Написать вручную можно после ответа клиента" };
  if (message.refusedAt) return { error: "Диалог помечен как отказ" };
  if (message.refusalSuggestedAt) return { error: "Сначала подтвердите или отклоните распознанный отказ" };
  if (message.lead?.handedOffAt) return { error: "Диалог уже передан менеджеру" };
  if (message.campaign.isDemo) {
    await prisma.replyMessage.create({
      data: { messageId: message.id, direction: "outbound", subject: `Re: ${message.subject}`, fromEmail: "demo@smailee.invalid", toEmail: message.contact.email, body, isAi: false, status: "SENT" },
    });
    refreshInbox();
    return { ok: "Тестовый ответ добавлен в диалог" };
  }
  if (!message.mailbox) return { error: "У письма не назначен ящик отправки" };
  const draft = await prisma.replyMessage.create({ data: { messageId: message.id, direction: "outbound", subject: `Re: ${message.subject}`, fromEmail: message.mailbox.email, toEmail: message.contact.email, body, isAi: false, status: "DRAFT" } });
  const sent = await approveAndSendReply(draft.id);
  if (!sent.ok) {
    await prisma.replyMessage.delete({ where: { id: draft.id } });
    return { error: sent.error ?? "Не удалось отправить ответ" };
  }
  refreshInbox();
  return { ok: "Ответ отправлен" };
}

export async function toggleConversationAi(formData: FormData): Promise<void> {
  const messageId = String(formData.get("messageId") || "");
  const { message } = await findOwnedMessage(messageId);
  if (!message) return;
  const enabled = !message.aiRepliesEnabled;
  await prisma.$transaction(async (tx) => {
    await tx.message.update({ where: { id: message.id }, data: { aiRepliesEnabled: enabled } });
    if (!enabled) {
      await tx.replyMessage.deleteMany({
        where: { messageId: message.id, status: "DRAFT", OR: [{ isAi: true }, { kind: "AUTO_PING" }] },
      });
    }
  });
  refreshInbox();
}

export async function confirmConversationRefusal(formData: FormData): Promise<void> {
  const messageId = String(formData.get("messageId") || "");
  const { workspace, message } = await findOwnedMessage(messageId);
  if (!message) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.message.update({
      where: { id: message.id },
      data: { refusedAt: now, refusalSuggestedAt: message.refusalSuggestedAt ?? now, autoPingStoppedAt: now, autoPingNextAt: null },
    }),
    prisma.contact.update({ where: { id: message.contactId }, data: { status: "UNSUBSCRIBED" } }),
    ...(!message.campaign.isDemo ? [prisma.suppression.upsert({
      where: { userId_email: { userId: workspace.owner.id, email: message.contact.email } },
      update: { reason: "declined_via_reply", releasedAt: null },
      create: { userId: workspace.owner.id, email: message.contact.email, reason: "declined_via_reply" },
    })] : []),
    prisma.replyMessage.deleteMany({ where: { messageId: message.id, kind: "AUTO_PING", status: "DRAFT" } }),
  ]);
  refreshInbox();
}

export async function dismissConversationRefusal(formData: FormData): Promise<void> {
  const messageId = String(formData.get("messageId") || "");
  const { message } = await findOwnedMessage(messageId);
  if (!message || message.refusedAt) return;
  await prisma.message.update({ where: { id: message.id }, data: { refusalSuggestedAt: null } });
  refreshInbox();
}

export async function saveConversationAutoPing(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const messageId = String(formData.get("messageId") || "");
  const { workspace, message } = await findOwnedMessage(messageId);
  if (!message) return { error: "Диалог не найден" };
  const mode = String(formData.get("mode") || "disabled");
  if (mode !== "enabled" && mode !== "disabled") return { error: "Некорректный режим автопинга" };
  const intervalDays = Math.trunc(Number(formData.get("intervalDays") || 7));
  if (intervalDays < 1 || intervalDays > 90) return { error: "Интервал должен быть от 1 до 90 дней" };
  const enabled = mode === "enabled";
  const wasEnabled = message.autoPingEnabled ?? workspace.owner.autoPingEnabled;
  const maxAttempts = message.autoPingMaxAttempts ?? workspace.owner.autoPingMaxAttempts;
  const exhausted = wasEnabled && message.autoPingAttempts >= maxAttempts;
  const restarting = enabled && (!wasEnabled || exhausted);
  const now = new Date();
  await prisma.$transaction([
    prisma.message.update({
      where: { id: message.id },
      data: {
        autoPingEnabled: enabled,
        autoPingIntervalDays: enabled ? intervalDays : null,
        autoPingMaxAttempts: null,
        ...(restarting ? {
          autoPingAttempts: 0,
          autoPingNextAt: nextSendWindowTime(new Date(now.getTime() + 60 * 60_000), config.sendWindow),
        } : {}),
        ...(!enabled ? { autoPingNextAt: null } : {}),
        autoPingStoppedAt: enabled ? null : now,
      },
    }),
    ...(!enabled ? [prisma.replyMessage.deleteMany({ where: { messageId: message.id, kind: "AUTO_PING", status: "DRAFT" } })] : []),
  ]);
  refreshInbox();
  return { ok: enabled ? exhausted ? "Автопинг продолжен" : "Автопинг включён" : "Автопинг отключён" };
}

export async function updateScheduledAutoPingDraft(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const messageId = String(formData.get("messageId") || "");
  const replyId = String(formData.get("replyId") || "");
  const body = String(formData.get("body") || "").trim();
  if (!body) return { error: "Текст автопинга не может быть пустым" };
  if (body.length > 10_000) return { error: "Текст автопинга слишком длинный" };
  const { message } = await findOwnedMessage(messageId);
  if (!message) return { error: "Диалог не найден" };
  const draft = await prisma.replyMessage.findFirst({
    where: { id: replyId, messageId: message.id, kind: "AUTO_PING", status: "DRAFT" },
  });
  if (!draft) return { error: "Запланированный автопинг уже отправлен или отменён" };
  await prisma.replyMessage.update({ where: { id: draft.id }, data: { body, isAi: false } });
  refreshInbox();
  return { ok: "Изменения сохранены" };
}
