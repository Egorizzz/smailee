"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret, hasEncKey } from "@/lib/crypto";
import { verifyBitrixWebhook } from "@/lib/services/bitrix";
import { pushLeadToCrm } from "@/server/inboundEngine";
import { sanitizeTriggerKeys } from "@/lib/crm/handoffTriggers";

/**
 * Подключение Битрикс24 и настройка передачи лидов.
 *
 * Вебхук проверяется ДО сохранения — тот же принцип, что и при подключении
 * почтового ящика (§5.1): не даём сохранить заведомо нерабочий доступ, иначе
 * клиент узнает о проблеме только когда первый тёплый лид молча не уедет в CRM.
 */
export async function saveCrmSettings(
  formData: FormData
): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();

  const triggers = sanitizeTriggerKeys(formData.getAll("crmHandoffTriggers").map(String));
  const customHandoffPrompt = String(formData.get("customHandoffPrompt") || "").trim() || null;
  const rawWebhook = String(formData.get("bitrixWebhook") || "").trim();

  // Минимум один сигнал ОБЯЗАТЕЛЕН независимо от того, подключён ли вебхук
  // сейчас: это то, по чему ИИ понимает, когда лид готов и пора остановиться.
  // Без единого сигнала линия держится бесконечно — риск важнее, чем
  // временное неудобство «нельзя снять последнюю галочку».
  if (triggers.length === 0 && !customHandoffPrompt) {
    return {
      error:
        "Выберите хотя бы один сценарий передачи или опишите свой — иначе ИИ не поймёт, когда лид готов, и будет вести переписку бесконечно.",
    };
  }

  // Пустое поле = отключить интеграцию. Отдельная ветка, чтобы не гонять
  // проверку на пустой строке и дать внятное подтверждение.
  if (!rawWebhook) {
    await prisma.user.update({
      where: { id: user.id },
      data: { bitrixWebhookEnc: null, crmHandoffTriggers: triggers, customHandoffPrompt },
    });
    revalidatePath("/app/settings");
    revalidatePath("/app/leads");
    return { ok: "Битрикс24 отключён — лиды остаются только в Smailee" };
  }

  if (!hasEncKey()) {
    return {
      error:
        "Не задан MAILBOX_ENC_KEY — без него вебхук нельзя сохранить зашифрованным, а в открытом виде мы его не храним",
    };
  }

  const check = await verifyBitrixWebhook(rawWebhook);
  if (!check.ok) return { error: check.error };

  await prisma.user.update({
    where: { id: user.id },
    data: { bitrixWebhookEnc: encryptSecret(rawWebhook), crmHandoffTriggers: triggers, customHandoffPrompt },
  });
  revalidatePath("/app/settings");
  revalidatePath("/app/leads");

  return {
    ok: check.owner
      ? `Битрикс24 подключён (портал отвечает как «${check.owner}»)`
      : "Битрикс24 подключён",
  };
}

/**
 * Передать лида в CRM вручную, минуя ИИ-квалификацию — оператор решает сам,
 * не дожидаясь, пока сработает какой-то из настроенных триггеров (или когда
 * они вовсе не настроены на нужный кейс). Закрывает линию так же, как
 * автоматическая передача: дальше с клиентом работает продавец в CRM.
 *
 * Тонкая обёртка: вся логика — в pushLeadToCrm (src/server/inboundEngine.ts),
 * не завязанной на Next-контекст, поэтому проверяемой интеграционными тестами.
 */
export async function pushLeadManually(
  formData: FormData
): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  const leadId = String(formData.get("leadId") || "");

  const res = await pushLeadToCrm(leadId, user.id);
  if (!res.ok) return { error: res.error };

  revalidatePath("/app/leads");
  return { ok: "Лид передан в CRM" };
}
