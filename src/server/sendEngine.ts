import "server-only";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/services/unisender";

/**
 * Движок отправки.
 *
 * Архитектура: очередь на самой БД (таблица Message со статусом PENDING).
 * Это проще, чем отдельный Redis, и надёжно: каждое письмо — строка со
 * статусом, отправка resumable. На проде тот же код можно вынести в отдельный
 * worker-процесс (см. src/server/worker.ts).
 *
 * MVP-throttle: обрабатываем ограниченный batch за проход + пауза между
 * письмами (защита от спам-паттерна и rate-limit провайдера).
 */

const THROTTLE_MS = Number(process.env.SEND_THROTTLE_MS ?? 300);
const BATCH_SIZE = Number(process.env.SEND_BATCH_SIZE ?? 50);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Простая подстановка переменных {{name}}, {{company}} и т.п.
function render(template: string, vars: Record<string, string | null | undefined>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}

/**
 * Обрабатывает pending-письма кампании. Возвращает сколько отправлено/ошибок.
 * Вызывается при запуске кампании и может дёргаться повторно (resume).
 */
export async function processCampaign(campaignId: string): Promise<{
  sent: number;
  failed: number;
  remaining: number;
}> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { sender: true },
  });
  if (!campaign) return { sent: 0, failed: 0, remaining: 0 };

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "SENDING", startedAt: campaign.startedAt ?? new Date() },
  });

  const pending = await prisma.message.findMany({
    where: { campaignId, status: "PENDING" },
    include: { contact: true },
    take: BATCH_SIZE,
  });

  let sent = 0;
  let failed = 0;

  for (const msg of pending) {
    const vars = {
      name: msg.contact.name,
      company: msg.contact.company,
      email: msg.contact.email,
    };
    const result = await sendEmail({
      fromEmail: campaign.sender?.fromEmail ?? "noreply@smailee.ru",
      fromName: campaign.sender?.fromName ?? "Smailee",
      toEmail: msg.contact.email,
      toName: msg.contact.name,
      subject: render(msg.subject, vars),
      body: render(msg.body, vars),
    });

    if (result.ok) {
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: result.providerMessageId,
        },
      });
      sent++;
    } else {
      await prisma.message.update({
        where: { id: msg.id },
        data: { status: "FAILED", error: result.error },
      });
      failed++;
    }

    await sleep(THROTTLE_MS);
  }

  const remaining = await prisma.message.count({
    where: { campaignId, status: "PENDING" },
  });

  if (remaining === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "SENT" },
    });
  }

  return { sent, failed, remaining };
}
