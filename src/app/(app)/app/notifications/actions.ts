"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, requireWorkspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";

export type NotificationSettingsState = { ok?: string; error?: string };

const schema = z.object({
  scope: z.enum(["OWN", "ALL"]),
  replyPolicy: z.enum(["ACTION_REQUIRED", "ALL"]),
  telegramReplyMode: z.enum(["OFF", "IMMEDIATE", "GROUPED"]),
  telegramWarmLeadMode: z.enum(["OFF", "IMMEDIATE", "GROUPED"]),
  telegramGroupMinutes: z.coerce.number().int().refine((value) => [5, 15, 30].includes(value)),
  emailDigestFrequency: z.enum(["HOURLY", "DAILY"]),
  emailDigestHourMsk: z.coerce.number().int().min(0).max(23),
});

export async function saveNotificationPreferences(
  _state: NotificationSettingsState,
  formData: FormData,
): Promise<NotificationSettingsState> {
  const workspace = await requireWorkspace();
  const canUseInbox = can(workspace, "LEADS_REPLY_OWN") || can(workspace, "LEADS_REPLY_ALL");
  if (!canUseInbox) return { error: "Для уведомлений нужен доступ к ответам в Inbox" };

  const parsed = schema.safeParse({
    scope: formData.get("scope"),
    replyPolicy: formData.get("replyPolicy"),
    telegramReplyMode: formData.get("telegramReplyMode"),
    telegramWarmLeadMode: formData.get("telegramWarmLeadMode"),
    telegramGroupMinutes: formData.get("telegramGroupMinutes"),
    emailDigestFrequency: formData.get("emailDigestFrequency"),
    emailDigestHourMsk: formData.get("emailDigestHourMsk"),
  });
  if (!parsed.success) return { error: "Проверьте выбранные параметры уведомлений" };
  if (parsed.data.scope === "ALL" && !can(workspace, "LEADS_REPLY_ALL")) {
    return { error: "У вас нет права получать ответы из всех кампаний" };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: workspace.actor.id },
      data: {
        customerNotificationScope: parsed.data.scope,
        replyNotificationPolicy: parsed.data.replyPolicy,
        telegramReplyMode: parsed.data.telegramReplyMode,
        telegramWarmLeadMode: parsed.data.telegramWarmLeadMode,
        telegramGroupMinutes: parsed.data.telegramGroupMinutes,
        emailDigestReplies: formData.get("emailDigestReplies") === "on",
        emailDigestWarmLeads: formData.get("emailDigestWarmLeads") === "on",
        emailDigestFrequency: parsed.data.emailDigestFrequency,
        emailDigestHourMsk: parsed.data.emailDigestHourMsk,
      },
    }),
    // Уже поставленные события могли быть рассчитаны по старой области,
    // частоте или каналам. Не доставляем их вопреки свежей настройке.
    prisma.customerNotificationDelivery.updateMany({
      where: { recipientId: workspace.actor.id, sentAt: null, canceledAt: null },
      data: { canceledAt: new Date(), lockedUntil: null, lastError: "Notification settings changed" },
    }),
  ]);

  revalidatePath("/app/settings/notifications");
  return { ok: "Настройки уведомлений сохранены" };
}
