
import { prisma } from "@/lib/prisma";
import { generateReply, qualifyLead } from "@/lib/services/llm";
import { pushLead } from "@/lib/services/bitrix";

/**
 * Обработка входящего ответа на письмо.
 *
 * В проде вызывается из вебхука провайдера (POST /api/inbound), когда клиент
 * отвечает на письмо. Сейчас та же логика доступна через «Симулировать ответ»
 * в карточке кампании, чтобы можно было проверить сценарий без реального inbound.
 *
 * Шаги: сохранить входящее → AI пишет ответ → AI квалифицирует → если HOT,
 * создаём/обновляем лид и (опц.) пушим в CRM.
 */
export async function handleInboundReply(input: {
  messageId: string;
  inboundBody: string;
}): Promise<{ replyBody: string; qualification: string }> {
  const message = await prisma.message.findUnique({
    where: { id: input.messageId },
    include: {
      contact: true,
      campaign: { include: { user: true, sender: true } },
      thread: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!message) throw new Error("message not found");

  // 1. Сохраняем входящее (как письмо в треде)
  await prisma.replyMessage.create({
    data: {
      messageId: message.id,
      direction: "inbound",
      subject: `Re: ${message.subject}`,
      fromEmail: message.contact.email,
      toEmail: message.campaign.sender?.fromEmail ?? "you@smailee.ru",
      body: input.inboundBody,
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
  await prisma.replyMessage.create({
    data: {
      messageId: message.id,
      direction: "outbound",
      subject: `Re: ${message.subject}`,
      fromEmail: message.campaign.sender?.fromEmail ?? "you@smailee.ru",
      toEmail: message.contact.email,
      body: replyBody,
      isAi: true,
    },
  });

  // 3. AI квалифицирует лида
  const {
    data: { qualification, summary },
  } = await qualifyLead({ thread });

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

  // 4. Тёплый лид → передаём в CRM (Битрикс24)
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
  }

  return { replyBody, qualification };
}
