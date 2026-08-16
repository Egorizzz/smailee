"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { deriveFunnelPrompt } from "@/lib/services/llm";
import {
  combineDialogSources,
  decodeDialogFile,
  DialogImportError,
  sampleDialogCorpus,
  validateDialogFile,
} from "@/lib/dialogImport";

export async function saveAiSettings(formData: FormData) {
  const { owner: user } = await requireOrganizationAdmin();
  const autoPingStartAfterDays = Math.min(90, Math.max(1, Math.trunc(Number(formData.get("autoPingStartAfterDays") || 7))));
  const autoPingIntervalDays = Math.min(90, Math.max(1, Math.trunc(Number(formData.get("autoPingIntervalDays") || 7))));
  const autoPingMaxAttempts = Math.min(20, Math.max(1, Math.trunc(Number(formData.get("autoPingMaxAttempts") || 3))));
  await prisma.user.update({
    where: { id: user.id },
    data: {
      aiModerationEnabled: formData.get("aiModerationEnabled") === "on",
      autoPingEnabled: formData.get("autoPingEnabled") === "on",
      autoPingStartAfterDays,
      autoPingIntervalDays,
      autoPingMaxAttempts,
      dialogStylePrompt: String(formData.get("dialogStylePrompt") || "").trim() || null,
      funnelPrompt: String(formData.get("funnelPrompt") || "") || null,
    },
  });
  revalidatePath("/app/settings");
  revalidatePath("/app/inbox");
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
  await requireOrganizationAdmin();

  const file = formData.get("dialogs");
  const pastedText = String(formData.get("dialogsText") || "");
  let fileText = "";

  try {
    if (file instanceof File && file.size > 0) {
      validateDialogFile(file.name, file.size);
      fileText = decodeDialogFile(new Uint8Array(await file.arrayBuffer()));
    }
  } catch (error) {
    if (error instanceof DialogImportError) return { error: error.message };
    console.error("[dialogs] failed to read uploaded file", error);
    return { error: "Не удалось прочитать файл. Попробуйте сохранить его как TXT или CSV" };
  }

  const corpus = combineDialogSources({
    fileText,
    fileName: file instanceof File ? file.name : undefined,
    pastedText,
  });

  if (corpus.trim().length < 100) {
    return { error: "Нужно хотя бы несколько реальных диалогов — по паре строк выводы делать не из чего" };
  }

  const prepared = sampleDialogCorpus(corpus);
  const outcome = await deriveFunnelPrompt(prepared.text);
  if (!outcome.data) return { error: outcome.notice ?? "Не удалось составить инструкцию" };
  return {
    prompt: outcome.data,
    notice:
      outcome.notice ??
      (prepared.sampled
        ? "Большая выгрузка проанализирована по репрезентативным фрагментам начала, середины и конца. Проверьте вывод ниже."
        : undefined),
  };
}
