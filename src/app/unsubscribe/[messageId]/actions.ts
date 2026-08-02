"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

/**
 * Отписка: добавляем в suppression + помечаем контакт. Публичное действие
 * (без авторизации) — вызывается со страницы отписки из письма.
 *
 * НАСЛЕДИЕ: новые письма больше не содержат ссылку отписки и заголовок
 * List-Unsubscribe (§«отписка» — модель Smailee строится на переписке
 * человек-человеку, отказ определяется по прямой просьбе в ответе, см.
 * inboundEngine.ts). Маршрут и это действие оставлены живыми ТОЛЬКО ради
 * писем, отправленных ДО этого изменения — у получателя может быть открыта
 * вкладка со старой ссылкой, и она обязана продолжать работать.
 */
export async function unsubscribeAction(formData: FormData) {
  const messageId = String(formData.get("messageId"));
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { contact: true, campaign: true },
  });
  if (!message) redirect(`/unsubscribe/${messageId}`);

  const userId = message.campaign.userId;
  const email = message.contact.email;

  await prisma.contact.update({
    where: { id: message.contactId },
    data: { status: "UNSUBSCRIBED" },
  });

  await prisma.suppression.upsert({
    where: { userId_email: { userId, email } },
    // releasedAt: null — если контакта уже возвращали в базу вручную, клик
    // по старой ссылке отписки означает "нет, я всё же хочу выйти", и запись
    // должна снова стать активной, а не остаться исторической.
    update: { reason: "unsubscribed", releasedAt: null },
    create: { userId, email, reason: "unsubscribed" },
  });

  await prisma.event.create({
    data: { messageId, type: "unsubscribe" },
  });

  redirect(`/unsubscribe/${messageId}`);
}
