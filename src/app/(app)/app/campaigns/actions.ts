"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateEmailVariants, type LlmProvider } from "@/lib/services/llm";
import { getPresetByKey } from "@/lib/emailPresets";
import { checkEmailQuota } from "@/server/limits";
import { processCampaign } from "@/server/sendEngine";

export async function generateVariants(
  provider?: LlmProvider
): Promise<{ variants: { subject: string; body: string }[]; notice?: string }> {
  const user = await requireUser();
  const outcome = await generateEmailVariants(
    {
      offer: user.offer ?? "Наш продукт помогает бизнесу.",
      targetAudience: user.targetAudience ?? "малый и средний бизнес",
      websiteUrl: user.websiteUrl,
      variants: 2,
    },
    provider
  );
  return { variants: outcome.data, notice: outcome.notice };
}

// Возвращает HTML пресета (для подстановки в форму при выборе шаблона).
// key вида "tpl:<id>" — пользовательский шаблон из БД (только владельца).
export async function loadPreset(key: string) {
  if (key.startsWith("tpl:")) {
    const user = await requireUser();
    const t = await prisma.emailTemplate.findFirst({
      where: { id: key.slice(4), OR: [{ userId: user.id }, { isPreset: true }] },
    });
    if (!t) return null;
    return { subject: t.subject, html: t.html, isHtml: t.category !== "custom-text" };
  }
  const p = getPresetByKey(key);
  if (!p) return null;
  return { subject: p.subject, html: p.html, isHtml: true };
}

// «Мои шаблоны»: сохранить текущее письмо из формы кампании в библиотеку
export async function saveAsTemplate(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  const subject = String(formData.get("subject") || "").trim();
  const body = String(formData.get("body") || "");
  const isHtml = formData.get("isHtml") === "on";

  if (!name) return { error: "Укажите название шаблона" };
  if (!subject || !body) return { error: "Заполните тему и текст письма перед сохранением" };

  await prisma.emailTemplate.create({
    data: {
      userId: user.id,
      name,
      // custom-text = plain-text шаблон (при загрузке в форму не включает HTML-режим)
      category: isHtml ? "custom" : "custom-text",
      subject,
      html: body,
      isPreset: false,
    },
  });
  revalidatePath("/app/templates");
  return { ok: `Шаблон «${name}» сохранён — см. «Шаблоны писем»` };
}

export async function deleteTemplate(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  await prisma.emailTemplate.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/app/templates");
}

export async function createCampaign(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") || "Без названия");
  const subject = String(formData.get("subject") || "");
  const body = String(formData.get("body") || "");
  const isHtml = formData.get("isHtml") === "on";
  const segment = String(formData.get("segment") || "");

  // A/B
  const abEnabled = formData.get("abEnabled") === "on";
  const subjectB = String(formData.get("subjectB") || "") || null;
  const bodyB = String(formData.get("bodyB") || "") || null;

  // follow-up
  const followupEnabled = formData.get("followupEnabled") === "on";
  const followupDays = Number(formData.get("followupDays") || 3);
  const followupSubject = String(formData.get("followupSubject") || "") || null;
  const followupBody = String(formData.get("followupBody") || "") || null;

  // расписание
  const scheduledRaw = String(formData.get("scheduledAt") || "");
  const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : null;

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      name,
      subject,
      body,
      isHtml,
      abEnabled,
      subjectB,
      bodyB,
      followupEnabled,
      followupDays,
      followupSubject,
      followupBody,
      scheduledAt,
      segment: segment || null,
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
    },
  });

  // материализуем письма только по ACTIVE-контактам (не suppressed/invalid)
  const contacts = await prisma.contact.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
      ...(segment ? { segment } : {}),
    },
  });

  // тарифная квота писем в месяц
  const quota = await checkEmailQuota(user, contacts.length);
  if (!quota.ok) {
    await prisma.campaign.delete({ where: { id: campaign.id } });
    redirect(`/app/campaigns/new?error=${encodeURIComponent(quota.error)}`);
  }

  if (contacts.length > 0) {
    await prisma.message.createMany({
      data: contacts.map((c, i) => {
        // A/B: чередуем варианты
        const useB = abEnabled && subjectB && bodyB && i % 2 === 1;
        return {
          campaignId: campaign.id,
          contactId: c.id,
          subject: useB ? subjectB! : subject,
          body: useB ? bodyB! : body,
          isHtml,
          variant: useB ? "B" : "A",
          step: 0,
          status: "PENDING" as const,
        };
      }),
    });
  }

  redirect(`/app/campaigns/${campaign.id}`);
}

// Запуск кампании: раскидывает письма по пулу ящиков клиента (§5.3, M2).
// Синхронный вызов processCampaign — для мгновенной обратной связи в dev;
// остаток (упёрлись в дневные лимиты) добьёт воркер на следующий день/тик.
export async function launchCampaign(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: user.id },
  });
  if (!campaign) return;

  // Гейт прогрева (ТЗ §5.6): без хотя бы одного ящика с warmupState=warm
  // (14 дней ramp пройдены) кампания не запускается — иначе первый холодный
  // отправитель домена ушёл бы "с холодного старта".
  const warmMailboxes = await prisma.mailbox.count({
    where: { userId: user.id, warmupState: "warm", connState: { in: ["ok", "paused"] } },
  });
  if (warmMailboxes === 0) {
    redirect(
      `/app/campaigns/${id}?error=${encodeURIComponent(
        "Ни один ящик ещё не прогрет (нужно 14 дней с момента подключения). Кампанию можно запустить, когда хотя бы один ящик пройдёт прогрев."
      )}`
    );
  }

  await prisma.campaign.update({
    where: { id },
    data: { status: "QUEUED" },
  });

  await processCampaign(id);
  revalidatePath(`/app/campaigns/${id}`);
  revalidatePath("/app/campaigns");
}
