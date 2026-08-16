"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, requireCapability, requireWorkspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { generateEmailVariants, type LlmProvider } from "@/lib/services/llm";
import { normalizePlaceholders } from "@/lib/mail/placeholders";
import { parseSegmentTexts } from "@/lib/campaigns/segmentTexts";
import { parseFollowupSteps } from "@/lib/campaigns/followupSteps";
import { checkEmailQuota } from "@/server/limits";
import { processCampaign } from "@/server/sendEngine";
import { isPlanActive } from "@/lib/plans";
import { getBusinessContext } from "@/lib/businessProfile/context";

export async function generateVariants(
  opts?: {
    /** Замечания к предыдущей генерации: «короче», «убери воду», «добавь цифры». */
    feedback?: string | null;
    /** Текущий вариант — чтобы ИИ дорабатывал его, а не писал с нуля. */
    previous?: { subject: string; body: string } | null;
    /** Сегмент, под который пишем: у каждого свои боли и лексика. */
    segment?: string | null;
    /**
     * Сколько вариантов вернуть. В мультисегментном мастере просим по одному
     * на сегмент: там и так N последовательных вызовов, а выбор из двух
     * вариантов на каждый сегмент превратил бы шаг в бесконечное ожидание.
     */
    count?: number;
    provider?: LlmProvider;
  }
): Promise<{ variants: { subject: string; body: string }[]; notice?: string; error?: string }> {
  const { owner: user } = await requireCapability("CAMPAIGNS_CREATE");
  try {
    const business = await getBusinessContext(user);
    const outcome = await generateEmailVariants(
      {
        offer: business.offer,
        targetAudience: business.targetAudience,
        websiteUrl: business.websiteUrl,
        businessContext: business.promptContext,
        variants: opts?.count ?? 2,
        feedback: opts?.feedback ?? null,
        previous: opts?.previous ?? null,
        segment: opts?.segment ?? null,
      },
      opts?.provider
    );
    return { variants: outcome.data, notice: outcome.notice };
  } catch (error) {
    return { variants: [], error: error instanceof Error ? error.message : "ИИ сейчас недоступен. Попробуйте ещё раз позже." };
  }
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
  const workspace = await requireCapability("CAMPAIGNS_CREATE");
  const user = workspace.owner;
  const name = String(formData.get("name") || "Без названия");
  // Плейсхолдеры приводим к каноническому виду и здесь, а не только на выходе
  // ИИ: текст мог быть набран руками или взят из шаблона, а «{Имя}» уходит в
  // письмо как literal «Имя» (см. src/lib/mail/placeholders.ts).
  const subject = normalizePlaceholders(String(formData.get("subject") || ""));
  const body = normalizePlaceholders(String(formData.get("body") || ""));
  // В продукте создаются только текстовые письма. HTML-альтернатива добавляется
  // движком отправки исключительно для пикселя Open Rate.
  const isHtml = false;
  // Мультисегмент: на каждый выбранный сегмент создаётся ОТДЕЛЬНАЯ кампания
  // (свой текст в будущем, своя статистика), объединённая общим batchId.
  // Одна кампания на все сегменты не годится: у сегментов разные отклики, и
  // смешанная статистика не даёт понять, какой из них сработал.
  const segments = formData.getAll("segments").map(String).filter(Boolean);
  const segment = String(formData.get("segment") || "");
  // Свой текст на каждый сегмент — мастер присылает их одним JSON-полем
  // { "<сегмент>": { subject, body } }. Сегменты отличаются содержательно
  // (другая боль, другая лексика), поэтому один текст на всех — это не
  // мультисегмент, а его имитация. Поля нет (старая форма, импорт) — работает
  // прежнее поведение: общий текст во все кампании пачки.
  const segmentTexts = parseSegmentTexts(String(formData.get("segmentTexts") || ""));
  const targetSegments: (string | null)[] =
    segments.length > 0 ? segments : [segment || null];

  // A/B
  const abEnabled = formData.get("abEnabled") === "on";
  const subjectB = normalizePlaceholders(String(formData.get("subjectB") || "")) || null;
  const bodyB = normalizePlaceholders(String(formData.get("bodyB") || "")) || null;

  // Трекинг открытий/кликов. Выключен, если галочку не поставили — намеренно
  // не «on по умолчанию»: пиксель снижает доставляемость, и боевую рассылку
  // правильнее гонять без него.
  const trackingEnabled = formData.get("trackingEnabled") === "on";

  // Follow-up: настраиваемая цепочка писем без ответа. Мастер присылает её
  // одним JSON-полем — по одному шагу за раз, а не флоскими
  // followupDays/Subject/Body (та схема поддерживает единственный шаг).
  const followupEnabled = formData.get("followupEnabled") === "on";
  const followupSteps = parseFollowupSteps(String(formData.get("followupSteps") || "")).map((s) => ({
    daysAfterPrevious: s.daysAfterPrevious,
    subject: normalizePlaceholders(s.subject),
    body: normalizePlaceholders(s.body),
  }));

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
    // текст этого сегмента, если мастер его прислал; иначе общий
    const own = seg ? segmentTexts[seg] : undefined;
    const segSubject = own ? normalizePlaceholders(own.subject) : subject;
    const segBody = own ? normalizePlaceholders(own.body) : body;

    const campaign = await prisma.campaign.create({
      data: {
        userId: user.id,
        createdById: workspace.actor.id,
        // одиночную кампанию называем как ввёл пользователь; в пачке к названию
        // добавляем сегмент, иначе кампании неразличимы в списке
        name: batchId ? autoCampaignName(name, seg) : name,
        subject: segSubject,
        body: segBody,
        isHtml,
        abEnabled,
        subjectB,
        bodyB,
        trackingEnabled,
        followupEnabled,
        scheduledAt,
        segment: seg,
        batchId,
        status: scheduledAt ? "SCHEDULED" : "DRAFT",
      },
    });
    created.push(campaign.id);

    // Цепочка одна на всю пачку сегментов (как trackingEnabled/abEnabled) —
    // раздельные follow-up-цепочки на сегмент не запрашивались, это была бы
    // отдельная фича поверх этой. stepNumber — позиция в массиве, 1..N.
    if (followupEnabled && followupSteps.length > 0) {
      await prisma.followupStep.createMany({
        data: followupSteps.map((s, i) => ({
          campaignId: campaign.id,
          stepNumber: i + 1,
          daysAfterPrevious: s.daysAfterPrevious,
          subject: s.subject,
          body: s.body,
        })),
      });
    }

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
            subject: useB ? subjectB! : segSubject,
            body: useB ? bodyB! : segBody,
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
  const workspace = await requireWorkspace();
  if (!can(workspace, "CAMPAIGNS_MANAGE_ALL") && !can(workspace, "CAMPAIGNS_MANAGE_OWN")) redirect("/app/campaigns");
  const user = workspace.owner;
  const id = String(formData.get("id"));
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: user.id, ...(can(workspace, "CAMPAIGNS_MANAGE_ALL") ? {} : { createdById: workspace.actor.id }) },
  });
  if (!campaign) return;

  if (!isPlanActive(user.plan, user.planExpiresAt)) {
    redirect(`/app/campaigns/${id}?error=${encodeURIComponent("Срок доступа завершён. Запуск и отправка кампаний недоступны до оплаты тарифа.")}`);
  }

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

export async function toggleCampaignArchive(formData: FormData) {
  const workspace = await requireWorkspace();
  if (!can(workspace, "CAMPAIGNS_MANAGE_ALL") && !can(workspace, "CAMPAIGNS_MANAGE_OWN")) return;
  const id = String(formData.get("id") || "");
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: workspace.owner.id, ...(can(workspace, "CAMPAIGNS_MANAGE_ALL") ? {} : { createdById: workspace.actor.id }) },
    select: { archivedAt: true },
  });
  if (!campaign) return;
  await prisma.campaign.update({ where: { id }, data: { archivedAt: campaign.archivedAt ? null : new Date() } });
  revalidatePath("/app/campaigns");
  revalidatePath(`/app/campaigns/${id}`);
}
