"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

// Отписка: добавляем в suppression + помечаем контакт. Публичное действие
// (без авторизации) — вызывается со страницы отписки из письма.
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
    update: { reason: "unsubscribed" },
    create: { userId, email, reason: "unsubscribed" },
  });

  await prisma.event.create({
    data: { messageId, type: "unsubscribe" },
  });

  redirect(`/unsubscribe/${messageId}`);
}
