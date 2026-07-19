"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleInboundReply, approveAndSendReply } from "@/server/inboundEngine";

// Симуляция ответа клиента на письмо — для проверки AI-диалога и квалификации
// без реального инбокса. В проде это же делает IMAP-поллинг (§5.4,
// pollInboundMailboxes в src/server/inboundEngine.ts, вызывается воркером).
export async function simulateReply(formData: FormData) {
  const user = await requireUser();
  const messageId = String(formData.get("messageId"));
  const text =
    String(formData.get("text") || "") ||
    "Здравствуйте! Интересно, сколько это стоит? Готовы обсудить.";

  // проверяем принадлежность
  const msg = await prisma.message.findFirst({
    where: { id: messageId, campaign: { userId: user.id } },
  });
  if (!msg) return;

  await handleInboundReply({ messageId, inboundBody: text });
  revalidatePath(`/app/campaigns`);
  revalidatePath(`/app/leads`);
}

// Одобрить черновик AI-ответа и реально отправить его (режим модерации, §5.5).
// Оператор может отредактировать текст перед отправкой: ИИ ошибается в деталях
// (цена, сроки, условия), и раньше выбор был бинарный — отправить как есть или
// отклонить. Правки сохраняются в черновик ДО отправки, поэтому уходит и
// остаётся в истории именно то, что оператор утвердил.
export async function approveDraftReply(formData: FormData) {
  const user = await requireUser();
  const replyId = String(formData.get("replyId"));
  const editedBody = String(formData.get("body") || "").trim();

  const reply = await prisma.replyMessage.findFirst({
    where: { id: replyId, message: { campaign: { userId: user.id } } },
  });
  if (!reply) return;

  if (editedBody && editedBody !== reply.body) {
    await prisma.replyMessage.update({
      where: { id: replyId },
      data: { body: editedBody, isAi: false }, // текст правил человек — уже не чистый ИИ
    });
  }

  await approveAndSendReply(replyId);
  revalidatePath(`/app/campaigns`);
}
