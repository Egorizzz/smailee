
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/services/unisender";
import { config } from "@/lib/config";

/**
 * Уведомление владельцу кабинета о новом тёплом лиде (F14 из PRODUCT.md).
 * Шлём на email аккаунта через тот же Unisender-адаптер, что и рассылки
 * (в mock-режиме просто логируется). Ошибка уведомления не должна ломать
 * основной сценарий — глотаем с console.error.
 */
export async function notifyOwnerOfHotLead(input: {
  userId: string;
  contactEmail: string;
  contactName?: string | null;
  summary?: string | null;
}): Promise<void> {
  try {
    const owner = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!owner) return;

    const who = input.contactName
      ? `${input.contactName} <${input.contactEmail}>`
      : input.contactEmail;

    await sendEmail({
      fromEmail: "noreply@smailee.ru",
      fromName: "Smailee",
      toEmail: owner.email,
      subject: `🔥 Новый тёплый лид: ${input.contactEmail}`,
      text: `У вас новый тёплый лид!\n\nКонтакт: ${who}\n${input.summary ? `Резюме AI: ${input.summary}\n` : ""}\nПосмотреть диалог: ${config.appUrl}/app/leads`,
      apiKey: owner.unisenderApiKey,
    });
  } catch (err) {
    console.error("[notifications] notifyOwnerOfHotLead failed:", err);
  }
}
