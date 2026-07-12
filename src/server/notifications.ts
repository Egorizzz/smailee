
import { prisma } from "@/lib/prisma";

/**
 * Уведомление владельцу кабинета о новом тёплом лиде (F14 из PRODUCT.md).
 *
 * M1: транспорт отправки (SMTP через ящик клиента) появится в M2 — пока
 * уведомление логируется. Раньше слалось через удалённый Unisender-адаптер.
 * Сигнатура сохранена: inboundEngine/диалоговый слой продолжает её вызывать.
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
    // TODO(M2): отправить письмо владельцу через SMTP-ящик. Пока — лог.
    console.log(
      `[notifications] тёплый лид для ${owner.email}: ${who}${input.summary ? ` — ${input.summary}` : ""}`
    );
  } catch (err) {
    console.error("[notifications] notifyOwnerOfHotLead failed:", err);
  }
}
