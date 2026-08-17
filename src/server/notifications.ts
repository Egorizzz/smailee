
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { sendViaMailbox } from "@/lib/mail/transport";
import { config } from "@/lib/config";

/**
 * Заявка «Настройте всё за меня» (онбординг-визард, R2) → письмо оператору
 * на config.setupNotifyEmail. Best-effort: своего системного SMTP у продукта
 * нет, поэтому шлём через первый рабочий (connState=ok) ящик пула — сначала
 * seed, потом любой. Если рабочих ящиков нет — только лог: заявка в любом
 * случае сохранена в БД и видна в админке.
 */
export async function notifySetupRequest(input: {
  userEmail: string;
  name: string;
  contact: string;
  preferredTime?: string | null;
}): Promise<void> {
  const text = [
    `Новая заявка «Настройте всё за меня» (Smailee)`,
    ``,
    `Кабинет: ${input.userEmail}`,
    `Имя: ${input.name}`,
    `Контакт: ${input.contact}`,
    input.preferredTime ? `Удобное время: ${input.preferredTime}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const mailbox = await prisma.mailbox.findFirst({
      where: { connState: "ok" },
      orderBy: [{ isSeed: "desc" }, { createdAt: "asc" }],
    });
    if (!mailbox) {
      console.log(`[notifications] setup request (нет рабочего ящика для email):\n${text}`);
      return;
    }
    const smtpPassword = decryptSecret(mailbox.smtpPasswordEnc);
    const result = await sendViaMailbox(mailbox, smtpPassword, {
      to: config.setupNotifyEmail,
      subject: `Smailee: заявка на настройку от ${input.userEmail}`,
      text,
    });
    if (!result.ok) {
      console.error(`[notifications] setup request email failed: ${result.error}\n${text}`);
    }
  } catch (err) {
    console.error("[notifications] notifySetupRequest failed:", err);
  }
}
