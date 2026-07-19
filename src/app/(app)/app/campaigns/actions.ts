"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateEmailVariants, type LlmProvider } from "@/lib/services/llm";
import { getPresetByKey } from "@/lib/emailPresets";
import { checkEmailQuota } from "@/server/limits";
import { processCampaign } from "@/server/sendEngine";
import {
  generateImage,
  imagesUsedToday,
  DAILY_IMAGE_LIMIT,
  isFalLive,
} from "@/lib/services/falai";

export async function generateVariants(
  opts?: {
    /** Замечания к предыдущей генерации: «короче», «убери воду», «добавь цифры». */
    feedback?: string | null;
    /** Текущий вариант — чтобы ИИ дорабатывал его, а не писал с нуля. */
    previous?: { subject: string; body: string } | null;
    /** Сегмент, под который пишем: у каждого свои боли и лексика. */
    segment?: string | null;
    provider?: LlmProvider;
  }
): Promise<{ variants: { subject: string; body: string }[]; notice?: string }> {
  const user = await requireUser();
  const outcome = await generateEmailVariants(
    {
      offer: user.offer ?? "Наш продукт помогает бизнесу.",
      targetAudience: user.targetAudience ?? "малый и средний бизнес",
      websiteUrl: user.websiteUrl,
      variants: 2,
      feedback: opts?.feedback ?? null,
      previous: opts?.previous ?? null,
      segment: opts?.segment ?? null,
    },
    opts?.provider
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

// Брендинг писем («Оформление»): цвет, логотип, шрифт и подпись клиента.
// Хранятся в профиле и применяются к фирменному каркасу (brandShell) во всех
// последующих кампаниях — настраивается один раз, а не в каждой кампании.
export async function saveBrand(input: {
  brandColor?: string | null;
  brandLogoUrl?: string | null;
  brandFont?: string | null;
  brandSignature?: string | null;
  companyName?: string | null;
}): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      brandColor: input.brandColor?.trim() || null,
      brandLogoUrl: input.brandLogoUrl?.trim() || null,
      brandFont: input.brandFont?.trim() || null,
      brandSignature: input.brandSignature?.trim() || null,
      ...(input.companyName !== undefined
        ? { companyName: input.companyName?.trim() || null }
        : {}),
    },
  });
  revalidatePath("/app/campaigns/new");
  revalidatePath("/app/settings");
  return { ok: true };
}

/**
 * Генерация картинки для письма через fal.ai (лимит 10/сутки на клиента,
 * см. src/lib/services/falai.ts). Возвращает URL, который вставляется в тело
 * письма — картинка живёт на стороне fal.ai, мы её не перезаливаем.
 */
export async function generateEmailImage(
  prompt: string
): Promise<{ url?: string; error?: string; usedToday: number; limit: number; mocked?: boolean }> {
  const user = await requireUser();
  const clean = prompt.trim();
  if (!clean) {
    const used = await imagesUsedToday(user.id);
    return { error: "Опишите, что должно быть на картинке", usedToday: used, limit: DAILY_IMAGE_LIMIT };
  }
  const res = await generateImage(clean, user.id);
  if (!res.ok) return { error: res.error, usedToday: res.usedToday, limit: res.limit };
  return { url: res.url, usedToday: res.usedToday, limit: res.limit, mocked: res.mocked };
}

/** Остаток дневного лимита картинок — для показа в UI до первой генерации. */
export async function imageQuota(): Promise<{ usedToday: number; limit: number; live: boolean }> {
  const user = await requireUser();
  return {
    usedToday: await imagesUsedToday(user.id),
    limit: DAILY_IMAGE_LIMIT,
    live: isFalLive,
  };
}

/**
 * Автоназвание для кампании по сегменту: при запуске пачки по 5 сегментам
 * руками придумывать 5 названий бессмысленно, а «Без названия (2)» в списке
 * не даёт понять, где какой сегмент.
 */
function autoCampaignName(base: string, segment: string | null): string {
  const date = new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  const head = base.trim() || "Кампания";
  return segment ? `${head} — ${segment}, ${date}` : `${head}, ${date}`;
}

export async function createCampaign(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") || "Без названия");
  const subject = String(formData.get("subject") || "");
  const body = String(formData.get("body") || "");
  const isHtml = formData.get("isHtml") === "on";
  // Мультисегмент: на каждый выбранный сегмент создаётся ОТДЕЛЬНАЯ кампания
  // (свой текст в будущем, своя статистика), объединённая общим batchId.
  // Одна кампания на все сегменты не годится: у сегментов разные отклики, и
  // смешанная статистика не даёт понять, какой из них сработал.
  const segments = formData.getAll("segments").map(String).filter(Boolean);
  const segment = String(formData.get("segment") || "");
  const targetSegments: (string | null)[] =
    segments.length > 0 ? segments : [segment || null];

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

  // пачка из нескольких сегментов помечается общим batchId
  const batchId = targetSegments.length > 1 ? `batch_${Date.now()}` : null;

  // Квоту считаем ПО ВСЕЙ пачке заранее: иначе первые сегменты создались бы,
  // а на середине упёрлись бы в лимит — пользователь получил бы наполовину
  // созданный набор кампаний вместо внятной ошибки.
  const totalContacts = await prisma.contact.count({
    where: {
      userId: user.id,
      status: "ACTIVE",
      ...(targetSegments.length === 1 && targetSegments[0] === null
        ? {}
        : { segment: { in: targetSegments.filter((s): s is string => s !== null) } }),
    },
  });
  const quota = await checkEmailQuota(user, totalContacts);
  if (!quota.ok) {
    redirect(`/app/campaigns/new?error=${encodeURIComponent(quota.error)}`);
  }

  const created: string[] = [];
  for (const seg of targetSegments) {
    const campaign = await prisma.campaign.create({
      data: {
        userId: user.id,
        // одиночную кампанию называем как ввёл пользователь; в пачке к названию
        // добавляем сегмент, иначе кампании неразличимы в списке
        name: batchId ? autoCampaignName(name, seg) : name,
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
        segment: seg,
        batchId,
        status: scheduledAt ? "SCHEDULED" : "DRAFT",
      },
    });
    created.push(campaign.id);

    // материализуем письма только по ACTIVE-контактам (не suppressed/invalid)
    const contacts = await prisma.contact.findMany({
      where: { userId: user.id, status: "ACTIVE", ...(seg ? { segment: seg } : {}) },
    });

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
  }

  revalidatePath("/app/campaigns");
  // пачку показываем списком (у каждой кампании своя статистика),
  // одиночную — сразу её карточкой
  redirect(created.length > 1 ? "/app/campaigns" : `/app/campaigns/${created[0]}`);
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
  // кампания не шлётся. R4: вместо красной ошибки — «Запустить после
  // прогрева»: кампания ждёт, воркер стартует её сам, когда первый ящик
  // станет warm (см. worker.ts).
  const warmMailboxes = await prisma.mailbox.count({
    where: { userId: user.id, warmupState: "warm", connState: { in: ["ok", "paused"] } },
  });
  if (warmMailboxes === 0) {
    await prisma.campaign.update({
      where: { id },
      data: { status: "SCHEDULED", launchAfterWarmup: true, scheduledAt: null },
    });
    revalidatePath(`/app/campaigns/${id}`);
    revalidatePath("/app/campaigns");
    return;
  }

  await prisma.campaign.update({
    where: { id },
    data: { status: "QUEUED", launchAfterWarmup: false },
  });

  await processCampaign(id);
  revalidatePath(`/app/campaigns/${id}`);
  revalidatePath("/app/campaigns");
}
