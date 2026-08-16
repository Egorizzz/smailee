"use server";

import { revalidatePath } from "next/cache";
import { can, requireWorkspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/services/telegram";

async function getAccessibleLead(leadId: string) {
  const workspace = await requireWorkspace();
  const canSeeAll = can(workspace, "LEADS_VIEW_ALL") || can(workspace, "LEADS_REPLY_ALL");
  const canSeeOwn = can(workspace, "LEADS_REPLY_OWN");
  if (!canSeeAll && !canSeeOwn) return { workspace, lead: null };
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, userId: workspace.owner.id, ...(canSeeAll ? {} : { message: { campaign: { createdById: workspace.actor.id } } }) },
    include: { message: { include: { contact: true, campaign: true } } },
  });
  return { workspace, lead };
}

export async function toggleLeadProcessed(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const leadId = String(formData.get("leadId") || "");
  const { lead } = await getAccessibleLead(leadId);
  if (!lead) return { error: "Лид не найден" };
  await prisma.lead.update({ where: { id: lead.id }, data: { processedAt: lead.processedAt ? null : new Date() } });
  revalidatePath("/app/inbox");
  revalidatePath("/app/analytics");
  revalidatePath("/app", "layout");
  return { ok: lead.processedAt ? "Возвращён в работу" : "Перемещён в обработанные" };
}

export async function sendLeadToTelegram(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const leadId = String(formData.get("leadId") || "");
  const { workspace, lead } = await getAccessibleLead(leadId);
  if (!lead) return { error: "Лид не найден" };
  if (!workspace.owner.telegramChatId || !config.telegram.botToken) return { error: "Telegram не подключён" };
  const contact = lead.message.contact;
  const who = contact.name ? `${contact.name} <${contact.email}>` : contact.email;
  const leadUrl = `${config.appUrl.replace(/\/$/, "")}/app/inbox?thread=${lead.messageId}`;
  const text = [
    "📨 <b>Лид из Smailee</b>",
    "",
    `<b>Контакт:</b> ${escapeTelegramHtml(who)}`,
    contact.company ? `<b>Компания:</b> ${escapeTelegramHtml(contact.company)}` : null,
    `<b>Кампания:</b> ${escapeTelegramHtml(lead.message.campaign.name)}`,
    lead.summary ? `<b>Резюме:</b> ${escapeTelegramHtml(lead.summary)}` : null,
  ].filter(Boolean).join("\n");
  try {
    await sendTelegramMessage(workspace.owner.telegramChatId, text, { replyMarkup: { inline_keyboard: [[{ text: "Открыть лид", url: leadUrl }]] } });
    return { ok: "Отправлен в Telegram" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось отправить в Telegram" };
  }
}
