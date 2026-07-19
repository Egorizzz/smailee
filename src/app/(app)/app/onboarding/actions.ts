"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deriveFunnelPrompt } from "@/lib/services/llm";

export async function saveOnboarding(formData: FormData) {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      companyName: String(formData.get("companyName") || "") || null,
      websiteUrl: String(formData.get("websiteUrl") || "") || null,
      offer: String(formData.get("offer") || "") || null,
      targetAudience: String(formData.get("targetAudience") || "") || null,
      aiModerationEnabled: formData.get("aiModerationEnabled") === "on",
      funnelPrompt: String(formData.get("funnelPrompt") || "") || null,
    },
  });
  revalidatePath("/app/settings");
  revalidatePath("/app");
}

/**
 * Составить инструкцию по воронке из выгрузки диалогов.
 * Текст возвращается в форму на редактирование, а НЕ сохраняется сразу:
 * ИИ мог что-то понять неверно, а это правила, по которым он будет отвечать
 * реальным клиентам — их нужно вычитать глазами.
 */
export async function suggestFunnelPrompt(
  formData: FormData
): Promise<{ prompt?: string; error?: string; notice?: string }> {
  await requireUser();

  const file = formData.get("dialogs");
  let text = String(formData.get("dialogsText") || "");

  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) {
      return { error: "Файл больше 2 МБ — оставьте самые показательные диалоги" };
    }
    text = await file.text();
  }

  if (text.trim().length < 100) {
    return { error: "Нужно хотя бы несколько реальных диалогов — по паре строк выводы делать не из чего" };
  }

  const outcome = await deriveFunnelPrompt(text);
  if (!outcome.data) return { error: outcome.notice ?? "Не удалось составить инструкцию" };
  return { prompt: outcome.data, notice: outcome.notice };
}
