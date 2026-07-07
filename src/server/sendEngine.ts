
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/services/unisender";
import { config } from "@/lib/config";

/**
 * Движок отправки.
 *
 * Очередь на БД (Message.status = PENDING). Каждое письмо — строка со статусом,
 * отправка resumable. Учитывает: suppression-список, warm-up лимиты отправителя,
 * HTML/plain, трекинг открытий (пиксель) и кликов (редирект), List-Unsubscribe.
 */

const THROTTLE_MS = config.send.throttleMs;
const BATCH_SIZE = config.send.batchSize;
const APP_URL = config.appUrl;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function render(template: string, vars: Record<string, string | null | undefined>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}

// Вставляет пиксель открытия и оборачивает ссылки в трекинг-редирект.
function instrumentHtml(html: string, messageId: string): string {
  // клики: заменяем href на редирект через наш домен
  let out = html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (_m, url) =>
      `href="${APP_URL}/api/track/click/${messageId}?url=${encodeURIComponent(url)}"`
  );
  // пиксель открытия
  const pixel = `<img src="${APP_URL}/api/track/open/${messageId}" width="1" height="1" style="display:none" alt="">`;
  if (out.includes("</body>")) out = out.replace("</body>", `${pixel}</body>`);
  else out += pixel;
  return out;
}

function unsubscribeUrl(messageId: string) {
  return `${APP_URL}/unsubscribe/${messageId}`;
}

// CTA "Оставить заявку" в письмах контент-серии — создаёт Lead для конкретного
// Message при клике (см. src/app/api/campaigns/cta/[messageId]/route.ts).
function leadCtaUrl(messageId: string) {
  return `${APP_URL}/api/campaigns/cta/${messageId}`;
}

async function checkWarmupLimit(senderId: string | null): Promise<boolean> {
  if (!senderId) return true;
  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (!sender) return true;
  const today = new Date().toDateString();
  const lastDate = sender.sentTodayDate?.toDateString();
  if (lastDate !== today) {
    // новый день — сброс счётчика + рост лимита прогрева
    await prisma.sender.update({
      where: { id: senderId },
      data: {
        sentToday: 0,
        sentTodayDate: new Date(),
        warmupDay: sender.warmupDay + 1,
        dailyLimit: Math.min(sender.dailyLimit + 20, 500),
      },
    });
    return true;
  }
  return sender.sentToday < sender.dailyLimit;
}

export async function processCampaign(campaignId: string): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
}> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { sender: true, user: true },
  });
  if (!campaign) return { sent: 0, failed: 0, skipped: 0, remaining: 0 };

  // отложенный запуск ещё не наступил
  if (campaign.scheduledAt && campaign.scheduledAt > new Date()) {
    return { sent: 0, failed: 0, skipped: 0, remaining: 0 };
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "SENDING", startedAt: campaign.startedAt ?? new Date() },
  });

  const pending = await prisma.message.findMany({
    where: { campaignId, status: "PENDING" },
    include: { contact: true },
    take: BATCH_SIZE,
  });

  // suppression-список пользователя
  const suppressed = new Set(
    (
      await prisma.suppression.findMany({
        where: { userId: campaign.userId },
        select: { email: true },
      })
    ).map((s) => s.email.toLowerCase())
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const msg of pending) {
    // не слать: suppression / невалидные / отписанные / bounced
    if (
      suppressed.has(msg.contact.email.toLowerCase()) ||
      msg.contact.status !== "ACTIVE"
    ) {
      await prisma.message.update({
        where: { id: msg.id },
        data: { status: "FAILED", error: "suppressed / not active" },
      });
      skipped++;
      continue;
    }

    // warm-up лимит отправителя
    if (!(await checkWarmupLimit(campaign.senderId))) {
      // лимит на сегодня исчерпан — оставляем PENDING, добьём завтра/воркером
      break;
    }

    const vars = {
      name: msg.contact.name,
      company: msg.contact.company,
      email: msg.contact.email,
      unsubscribe_url: unsubscribeUrl(msg.id),
      cta_url: campaign.user.websiteUrl ?? APP_URL,
      lead_cta_url: leadCtaUrl(msg.id),
    };

    const subject = render(msg.subject, vars);
    let bodyRendered = render(msg.body, vars);
    if (msg.isHtml) {
      bodyRendered = instrumentHtml(bodyRendered, msg.id);
    } else {
      // R6: plain-text письма получают текстовую ссылку отписки в конце
      bodyRendered += `\n\n—\nОтписаться от рассылки: ${unsubscribeUrl(msg.id)}`;
    }

    const result = await sendEmail({
      fromEmail: campaign.sender?.fromEmail ?? "noreply@smailee.ru",
      fromName: campaign.sender?.fromName ?? "Smailee",
      toEmail: msg.contact.email,
      toName: msg.contact.name,
      subject,
      html: msg.isHtml ? bodyRendered : undefined,
      text: msg.isHtml ? undefined : bodyRendered,
      replyTo: `reply+${msg.id}@${campaign.sender?.domain ?? "smailee.ru"}`,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl(msg.id)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      trackLinks: msg.isHtml,
      trackRead: true,
      campaignId: campaign.id,
      apiKey: campaign.user.unisenderApiKey,
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
      if (campaign.senderId) {
        await prisma.sender.update({
          where: { id: campaign.senderId },
          data: { sentToday: { increment: 1 } },
        });
      }
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

  // Для SERIES кампания завершается отдельно (materializeDueSteps), когда
  // отправлен последний шаг серии — здесь остановка была бы преждевременной,
  // т.к. следующая волна писем материализуется позже, по расписанию.
  if (remaining === 0 && campaign.type === "BLAST") {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "SENT" },
    });
  }

  return { sent, failed, skipped, remaining };
}

/**
 * Follow-up: для писем без ответа спустя followupDays создаёт письмо step=1.
 * Вызывается воркером периодически.
 */
export async function processFollowups(campaignId: string): Promise<number> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign || !campaign.followupEnabled) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - campaign.followupDays);

  // письма step=0, отправленные раньше cutoff, без ответа и без follow-up
  const candidates = await prisma.message.findMany({
    where: {
      campaignId,
      step: 0,
      repliedAt: null,
      followupSentAt: null,
      sentAt: { lte: cutoff },
      status: { in: ["SENT", "DELIVERED", "OPENED"] },
    },
    take: 100,
  });

  let created = 0;
  for (const m of candidates) {
    await prisma.message.create({
      data: {
        campaignId,
        contactId: m.contactId,
        subject: campaign.followupSubject || `Re: ${m.subject}`,
        body: campaign.followupBody || "Здравствуйте! Хотел уточнить, актуально ли ещё моё предложение?",
        isHtml: false,
        step: 1,
        status: "PENDING",
      },
    });
    await prisma.message.update({
      where: { id: m.id },
      data: { followupSentAt: new Date() },
    });
    created++;
  }
  return created;
}
