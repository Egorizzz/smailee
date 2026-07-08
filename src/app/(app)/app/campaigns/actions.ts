"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateEmailVariants, type LlmProvider } from "@/lib/services/llm";
import { sendEmail } from "@/lib/services/unisender";
import { processCampaign } from "@/server/sendEngine";
import { getPresetByKey } from "@/lib/emailPresets";
import { renderContentEmailHtml } from "@/lib/contentEmailTemplate";
import { checkEmailQuota } from "@/server/limits";

export async function generateVariants(
  provider?: LlmProvider,
  opts?: { asHtml?: boolean }
): Promise<{
  variants: { subject: string; body: string }[];
  notice?: string;
  isHtml: boolean;
}> {
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

  // Режим «AI наполняет HTML-шаблон»: тот же сгенерированный текст оборачиваем
  // в брендовый HTML-каркас (как у писем контент-серий) — выполняет обещание
  // лендинга/галереи, не затирая HTML plain-текстом.
  if (opts?.asHtml) {
    return {
      variants: outcome.data.map((v) => ({
        subject: v.subject,
        body: renderContentEmailHtml({
          subject: v.subject,
          bodyText: v.body,
          includeCta: true,
          ctaLabel: "Обсудить",
        }),
      })),
      notice: outcome.notice,
      isHtml: true,
    };
  }

  return { variants: outcome.data, notice: outcome.notice, isHtml: false };
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
  const senderId = String(formData.get("senderId") || "") || null;

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
      senderId: senderId || undefined,
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

export async function launchCampaign(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: user.id },
  });
  if (!campaign) return;

  await prisma.campaign.update({
    where: { id },
    data: { status: "QUEUED" },
  });

  await processCampaign(id);
  revalidatePath(`/app/campaigns/${id}`);
  revalidatePath("/app/campaigns");
}

// Тестовое письмо «отправить себе» перед запуском
export async function sendTestEmail(formData: FormData) {
  const user = await requireUser();
  const subject = String(formData.get("subject") || "Тест");
  const body = String(formData.get("body") || "");
  const isHtml = formData.get("isHtml") === "on";
  const to = String(formData.get("testEmail") || user.email);

  const demoVars: Record<string, string> = {
    name: "Тест",
    company: "Тестовая компания",
    unsubscribe_url: "#",
    cta_url: user.websiteUrl ?? "#",
  };
  const render = (t: string) =>
    t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => demoVars[k] ?? "");

  await sendEmail({
    fromEmail: "test@smailee.ru",
    fromName: "Smailee (тест)",
    toEmail: to,
    subject: `[ТЕСТ] ${render(subject)}`,
    html: isHtml ? render(body) : undefined,
    text: isHtml ? undefined : render(body),
    apiKey: user.unisenderApiKey,
  });

  revalidatePath("/app/campaigns/new");
}
