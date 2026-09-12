"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { can, requireCapability, requireWorkspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import {
  generateEmailVariants,
  generatePersonalizedEmail,
  LlmPersonalizationRejectedError,
  type LlmProvider,
} from "@/lib/services/llm";
import { normalizePlaceholders } from "@/lib/mail/placeholders";
import { recipientPersonalization } from "@/lib/mail/recipientPersonalization";
import { parseSegmentTexts } from "@/lib/campaigns/segmentTexts";
import { parseFollowupSteps } from "@/lib/campaigns/followupSteps";
import { checkEmailQuota } from "@/server/limits";
import { isPlanActive } from "@/lib/plans";
import { getBusinessContext } from "@/lib/businessProfile/context";
import {
  isDemoWorkspaceActive,
  DEMO_EXAMPLE_EMAILS_MAX,
} from "@/lib/demoWorkspace";
import { simulateDemoCampaign } from "@/server/demoWorkspace";
import type { Prisma } from "@prisma/client";
import {
  PERSONALIZED_EMAIL_REVISION,
  personalizedEmailContextHash,
} from "@/lib/campaigns/personalizedEmail";
import {
  PERSONALIZED_PREVIEW_INITIAL_MAX,
  parsePersonalizedPreviews,
  personalizedPreviewKey,
  type CampaignPreviewRecipient,
  type CampaignPersonalizedPreviewItem,
} from "@/lib/campaigns/personalizedPreview";
import { parseCampaignScheduledAt } from "@/lib/campaigns/campaignSchedule";
import { config } from "@/lib/config";
import { isWithinSendWindow } from "@/lib/schedule";
import {
  blockedCompanyIdsForCampaign,
  campaignHistoryEligibilityWhere,
} from "@/server/contactHistory";
import { preparePersonalizedEmail } from "@/server/campaigns/preparePersonalizedEmail";

export async function generateVariants(opts?: {
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
}): Promise<{
  variants: { subject: string; body: string }[];
  notice?: string;
  error?: string;
}> {
  const { owner: user } = await requireCapability("CAMPAIGNS_CREATE");
  if (!isPlanActive(user.plan, user.planExpiresAt))
    return {
      variants: [],
      error:
        "Доступ приостановлен. Оплатите тариф, чтобы продолжить работу с кампаниями.",
    };
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
      opts?.provider,
    );
    return { variants: outcome.data, notice: outcome.notice };
  } catch (error) {
    return {
      variants: [],
      error:
        error instanceof Error
          ? error.message
          : "ИИ сейчас недоступен. Попробуйте ещё раз позже.",
    };
  }
}

/**
 * Автоназвание для кампании по сегменту: при запуске пачки по 5 сегментам
 * руками придумывать 5 названий бессмысленно, а «Без названия (2)» в списке
 * не даёт понять, где какой сегмент.
 */
function autoCampaignName(base: string, segment: string | null): string {
  const date = new Date().toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
  const head = base.trim() || "Кампания";
  return segment ? `${head} — ${segment}, ${date}` : `${head}, ${date}`;
}

function personalizeDemoCopy(
  value: string,
  contact: { name: string | null; company: string | null; email: string },
) {
  const variables = recipientPersonalization({
    name: contact.name,
    email: contact.email,
    communicationNameOverride: contact.company,
  });
  return Object.entries(variables)
    .reduce(
      (text, [key, replacement]) =>
        text.replaceAll(`{{${key}}}`, replacement ?? ""),
      value,
    )
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/!{2,}/g, "!")
    .replace(/\.{2,}/g, ".")
    .replace(/ {2,}/g, " ")
    .trim();
}

type RecipientScope = "contacts" | "control" | "all";

function campaignRecipientWhere(
  userId: string,
  demoActive: boolean,
  segment: string | null,
  recipientScope: RecipientScope,
  blockedCompanyIds: string[],
): Prisma.ContactWhereInput {
  const regularContacts: Prisma.ContactWhereInput = {
    isControl: false,
    ...(segment ? { segment } : {}),
    ...(!demoActive ? campaignHistoryEligibilityWhere(blockedCompanyIds) : {}),
  };
  const audience: Prisma.ContactWhereInput =
    recipientScope === "control"
      ? { isControl: true }
      : recipientScope === "all"
        ? { OR: [{ isControl: true }, regularContacts] }
        : regularContacts;
  return {
    userId,
    isDemo: demoActive,
    status: "ACTIVE",
    relevanceStatus: "RELEVANT",
    ...audience,
  };
}

type PersonalizedPreviewOptions = {
  name: string;
  subject: string;
  body: string;
  segments: string[];
  segmentTexts: Record<string, { subject: string; body: string }>;
  recipientScope: RecipientScope;
  onboarding: boolean;
};

export async function previewPersonalizedEmails(
  opts: PersonalizedPreviewOptions,
): Promise<{
  items: CampaignPersonalizedPreviewItem[];
  recipients: CampaignPreviewRecipient[];
  error?: string;
}> {
  const workspace = await requireCapability("CAMPAIGNS_CREATE");
  const user = workspace.owner;
  if (!isPlanActive(user.plan, user.planExpiresAt)) {
    return {
      items: [],
      recipients: [],
      error: "Доступ приостановлен. Оплатите тариф, чтобы подготовить письма.",
    };
  }
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  const recipientScope: RecipientScope =
    opts.onboarding &&
    ["contacts", "control", "all"].includes(opts.recipientScope)
      ? opts.recipientScope
      : "contacts";
  const segments =
    recipientScope === "control"
      ? []
      : opts.segments.filter(Boolean).slice(0, 20);
  const targetSegments: Array<string | null> = segments.length
    ? segments
    : [null];
  const blockedCompanyIds = demoActive
    ? []
    : await blockedCompanyIdsForCampaign(user.id);
  const business = await getBusinessContext(user);
  const items: CampaignPersonalizedPreviewItem[] = [];
  const recipients: CampaignPreviewRecipient[] = [];

  try {
    for (const segment of targetSegments) {
      const contacts = await prisma.contact.findMany({
        where: campaignRecipientWhere(
          user.id,
          demoActive,
          segment,
          recipientScope,
          blockedCompanyIds,
        ),
        include: { sourceCompany: { include: { siteIntelligence: true } } },
        orderBy: [{ isControl: "desc" }, { email: "asc" }],
      });
      const copy = segment ? opts.segmentTexts[segment] : null;
      const subjectGuide = normalizePlaceholders(
        copy?.subject ?? opts.subject,
      ).trim();
      const bodyGuide = normalizePlaceholders(copy?.body ?? opts.body).trim();
      if (!subjectGuide || !bodyGuide) continue;

      for (const contact of contacts) {
        recipients.push({
          contactId: contact.id,
          segment,
          email: contact.email,
          name: contact.name,
          company: contact.company,
        });
        if (items.length >= PERSONALIZED_PREVIEW_INITIAL_MAX) continue;
        if (contact.isControl || demoActive) {
          items.push({
            contactId: contact.id,
            segment,
            email: contact.email,
            name: contact.name,
            company: contact.company,
            subject: personalizeDemoCopy(subjectGuide, contact),
            body: personalizeDemoCopy(bodyGuide, contact),
            personalizationMode: "personalized",
            usedContextIds: [],
          });
          continue;
        }

        const prepared = await preparePersonalizedEmail({
          owner: user,
          contact,
          campaign: {
            name: opts.name.trim() || "Кампания",
            segment,
            step: 0,
            subjectGuide,
            bodyGuide,
          },
          business,
        });
        try {
          const generated = await generatePersonalizedEmail(
            prepared.generationInput,
          );
          const generatedMode = generated.data.usedContextIds.length
            ? "personalized"
            : "generic";
          items.push({
            contactId: contact.id,
            segment,
            email: contact.email,
            name: contact.name,
            company: contact.company,
            subject: generated.data.subject,
            body: generated.data.body,
            personalizationMode: generatedMode,
            usedContextIds: generated.data.usedContextIds,
          });
        } catch (error) {
          if (
            !(error instanceof LlmPersonalizationRejectedError) ||
            !error.candidate
          )
            throw error;
          items.push({
            contactId: contact.id,
            segment,
            email: contact.email,
            name: contact.name,
            company: contact.company,
            subject: error.candidate.subject,
            body: error.candidate.body,
            personalizationMode: error.candidate.usedContextIds.length
              ? "personalized"
              : "generic",
            usedContextIds: error.candidate.usedContextIds,
            reviewRequired: true,
          });
        }
      }
    }
  } catch (error) {
    console.error("[CMP-2201] personalized campaign preview", {
      userId: user.id,
      error,
    });
    return {
      items: [],
      recipients: [],
      error:
        "Не удалось подготовить персональные примеры. Попробуйте ещё раз. Код: CMP-2201",
    };
  }

  if (!items.length) {
    return {
      items: [],
      recipients: [],
      error: "В выбранной аудитории нет получателей для предпросмотра.",
    };
  }
  return { items, recipients };
}

export async function previewPersonalizedEmailForRecipient(
  opts: PersonalizedPreviewOptions & {
    contactId: string;
    segment: string | null;
  },
): Promise<{ item?: CampaignPersonalizedPreviewItem; error?: string }> {
  const workspace = await requireCapability("CAMPAIGNS_CREATE");
  const user = workspace.owner;
  if (!isPlanActive(user.plan, user.planExpiresAt)) {
    return {
      error: "Доступ приостановлен. Оплатите тариф, чтобы подготовить письмо.",
    };
  }
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  const recipientScope: RecipientScope =
    opts.onboarding &&
    ["contacts", "control", "all"].includes(opts.recipientScope)
      ? opts.recipientScope
      : "contacts";
  const allowedSegments =
    recipientScope === "control"
      ? []
      : opts.segments.filter(Boolean).slice(0, 20);
  const segment =
    opts.segment && allowedSegments.includes(opts.segment)
      ? opts.segment
      : null;
  if (opts.segment && segment === null)
    return { error: "Получатель не входит в выбранную аудиторию." };
  const blockedCompanyIds = demoActive
    ? []
    : await blockedCompanyIdsForCampaign(user.id);

  const contact = await prisma.contact.findFirst({
    where: {
      ...campaignRecipientWhere(
        user.id,
        demoActive,
        segment,
        recipientScope,
        blockedCompanyIds,
      ),
      id: opts.contactId,
    },
    include: { sourceCompany: { include: { siteIntelligence: true } } },
  });
  if (!contact)
    return { error: "Получатель больше не входит в выбранную аудиторию." };

  const copy = segment ? opts.segmentTexts[segment] : null;
  const subjectGuide = normalizePlaceholders(
    copy?.subject ?? opts.subject,
  ).trim();
  const bodyGuide = normalizePlaceholders(copy?.body ?? opts.body).trim();
  if (!subjectGuide || !bodyGuide)
    return { error: "Заполните тему и текст письма." };

  if (contact.isControl || demoActive) {
    return {
      item: {
        contactId: contact.id,
        segment,
        email: contact.email,
        name: contact.name,
        company: contact.company,
        subject: personalizeDemoCopy(subjectGuide, contact),
        body: personalizeDemoCopy(bodyGuide, contact),
        personalizationMode: "personalized",
        usedContextIds: [],
      },
    };
  }
  try {
    const prepared = await preparePersonalizedEmail({
      owner: user,
      contact,
      campaign: {
        name: opts.name.trim() || "Кампания",
        segment,
        step: 0,
        subjectGuide,
        bodyGuide,
      },
    });
    const generated = await generatePersonalizedEmail(
      prepared.generationInput,
    );
    return {
      item: {
        contactId: contact.id,
        segment,
        email: contact.email,
        name: contact.name,
        company: contact.company,
        subject: generated.data.subject,
        body: generated.data.body,
        personalizationMode: generated.data.usedContextIds.length
          ? "personalized"
          : "generic",
        usedContextIds: generated.data.usedContextIds,
      },
    };
  } catch (error) {
    if (error instanceof LlmPersonalizationRejectedError && error.candidate) {
      return {
        item: {
          contactId: contact.id,
          segment,
          email: contact.email,
          name: contact.name,
          company: contact.company,
          subject: error.candidate.subject,
          body: error.candidate.body,
          personalizationMode: error.candidate.usedContextIds.length
            ? "personalized"
            : "generic",
          usedContextIds: error.candidate.usedContextIds,
          reviewRequired: true,
        },
      };
    }
    console.error("[CMP-2202] personalized recipient preview", {
      userId: user.id,
      contactId: contact.id,
      error,
    });
    return {
      error: "Не удалось подготовить письмо. Попробуйте ещё раз. Код: CMP-2202",
    };
  }
}

export async function createCampaign(formData: FormData) {
  const workspace = await requireCapability("CAMPAIGNS_CREATE");
  const user = workspace.owner;
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  const onboarding = formData.get("onboarding") === "1";
  const recipientScopeRaw = String(
    formData.get("recipientScope") || "contacts",
  );
  const recipientScope =
    onboarding && ["contacts", "control", "all"].includes(recipientScopeRaw)
      ? (recipientScopeRaw as "contacts" | "control" | "all")
      : "contacts";
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
  const segments =
    recipientScope === "control"
      ? []
      : formData.getAll("segments").map(String).filter(Boolean);
  const segment =
    recipientScope === "control" ? "" : String(formData.get("segment") || "");
  // Свой текст на каждый сегмент — мастер присылает их одним JSON-полем
  // { "<сегмент>": { subject, body } }. Сегменты отличаются содержательно
  // (другая боль, другая лексика), поэтому один текст на всех — это не
  // мультисегмент, а его имитация. Поля нет (старая форма, импорт) — работает
  // прежнее поведение: общий текст во все кампании пачки.
  const segmentTexts = parseSegmentTexts(
    String(formData.get("segmentTexts") || ""),
  );
  const targetSegments: (string | null)[] =
    segments.length > 0 ? segments : [segment || null];
  const blockedCompanyIds = demoActive
    ? []
    : await blockedCompanyIdsForCampaign(user.id);
  const recipientWhere = (seg: string | null) =>
    campaignRecipientWhere(
      user.id,
      demoActive,
      seg,
      recipientScope,
      blockedCompanyIds,
    );

  // A/B законсервирован: колонки оставлены для старых кампаний, новые всегда
  // создаются с одним вариантом и персонализируются на уровне получателя.
  const abEnabled = false;
  const subjectB = null;
  const bodyB = null;

  // Трекинг открытий/кликов. Выключен, если галочку не поставили — намеренно
  // не «on по умолчанию»: пиксель снижает доставляемость, и боевую рассылку
  // правильнее гонять без него.
  const trackingEnabled = formData.get("trackingEnabled") === "on";

  // Follow-up: настраиваемая цепочка писем без ответа. Мастер присылает её
  // одним JSON-полем — по одному шагу за раз, а не флоскими
  // followupDays/Subject/Body (та схема поддерживает единственный шаг).
  const followupEnabled = formData.get("followupEnabled") === "on";
  const followupSteps = parseFollowupSteps(
    String(formData.get("followupSteps") || ""),
  ).map((s) => ({
    daysAfterPrevious: s.daysAfterPrevious,
    subject: normalizePlaceholders(s.subject),
    body: normalizePlaceholders(s.body),
  }));

  // расписание
  const scheduledRaw = String(formData.get("scheduledAt") || "");
  const scheduledAt = parseCampaignScheduledAt(
    scheduledRaw,
    String(formData.get("timezoneOffset") || "-180"),
  );
  const sendAnytime = formData.get("sendAnytime") === "on";
  if (!scheduledAt) {
    redirect(
      `${onboarding ? "/app/setup?s=6&" : "/app/campaigns/new?"}error=${encodeURIComponent("Укажите корректные дату и время запуска")}`,
    );
  }
  const personalizedPreviews = parsePersonalizedPreviews(
    String(formData.get("personalizedPreviews") || ""),
  );
  const previewByRecipient = new Map(
    personalizedPreviews.map((item) => [
      personalizedPreviewKey(item.contactId, item.segment),
      item,
    ]),
  );

  // пачка из нескольких сегментов помечается общим batchId
  const batchId = targetSegments.length > 1 ? `batch_${randomUUID()}` : null;

  // Квоту считаем ПО ВСЕЙ пачке заранее: иначе первые сегменты создались бы,
  // а на середине упёрлись бы в лимит — пользователь получил бы наполовину
  // созданный набор кампаний вместо внятной ошибки.
  const totalContacts = (
    await Promise.all(
      targetSegments.map((seg) =>
        prisma.contact.count({ where: recipientWhere(seg) }),
      ),
    )
  ).reduce((sum, count) => sum + count, 0);
  if (!demoActive) {
    const quota = await checkEmailQuota(user, totalContacts);
    if (!quota.ok) {
      redirect(
        `${onboarding ? "/app/setup?s=6&" : "/app/campaigns/new?"}error=${encodeURIComponent(quota.error)}`,
      );
    }
  }

  const now = new Date();
  const warmMailboxes = demoActive
    ? 1
    : await prisma.mailbox.count({
        where: {
          userId: user.id,
          warmupState: "warm",
          connState: { in: ["ok", "paused"] },
        },
      });
  const launchAfterWarmup = !demoActive && warmMailboxes === 0;
  const canStartNow =
    scheduledAt <= now &&
    (sendAnytime || isWithinSendWindow(now, config.sendWindow));
  const initialStatus = demoActive
    ? scheduledAt > now
      ? ("SCHEDULED" as const)
      : ("QUEUED" as const)
    : launchAfterWarmup || scheduledAt > now
      ? ("SCHEDULED" as const)
      : ("QUEUED" as const);

  // Кампания, её сегментная пачка, цепочки и получатели — один агрегат.
  // Частичная пачка опаснее явной ошибки: часть сегментов могла бы уже уйти в
  // очередь, пока следующая кампания не создалась. Поэтому сохраняем всё или
  // ничего; внешних LLM/SMTP-вызовов внутри транзакции нет.
  const created = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const seg of targetSegments) {
    // текст этого сегмента, если мастер его прислал; иначе общий
    const own = seg ? segmentTexts[seg] : undefined;
    const segSubject = own ? normalizePlaceholders(own.subject) : subject;
    const segBody = own ? normalizePlaceholders(own.body) : body;

    const campaign = await tx.campaign.create({
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
        sendAnytime,
        launchAfterWarmup,
        segment: seg,
        batchId,
        status: initialStatus,
        isDemo: demoActive,
      },
    });
    ids.push(campaign.id);

    // Цепочка одна на всю пачку сегментов (как trackingEnabled/abEnabled) —
    // раздельные follow-up-цепочки на сегмент не запрашивались, это была бы
    // отдельная фича поверх этой. stepNumber — позиция в массиве, 1..N.
    if (followupEnabled && followupSteps.length > 0) {
      await tx.followupStep.createMany({
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
    const contacts = await tx.contact.findMany({
      where: recipientWhere(seg),
      ...(demoActive
        ? { take: DEMO_EXAMPLE_EMAILS_MAX, orderBy: { email: "asc" as const } }
        : {}),
    });

    if (demoActive) {
      const audienceSize = await tx.contact.count({
        where: recipientWhere(seg),
      });
      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          demoAudienceSize: audienceSize,
          demoGeneratedCount: contacts.length,
          demoStats: {
            audience: audienceSize,
            sent: 0,
            delivered: 0,
            opened: 0,
            replied: 0,
            warm: 0,
            generatedExamples: contacts.length,
            replyExamples: 0,
          },
        },
      });
    }

    if (contacts.length > 0) {
      await tx.message.createMany({
        data: contacts.map((c) => {
          const preview = previewByRecipient.get(
            personalizedPreviewKey(c.id, seg),
          );
          const controlSubject = c.isControl
            ? personalizeDemoCopy(segSubject, c)
            : null;
          const controlBody = c.isControl
            ? personalizeDemoCopy(segBody, c)
            : null;
          const ready =
            demoActive ||
            Boolean(preview && !preview.reviewRequired) ||
            c.isControl;
          return {
            campaignId: campaign.id,
            contactId: c.id,
            subject:
              preview?.subject ??
              controlSubject ??
              (demoActive ? personalizeDemoCopy(segSubject, c) : segSubject),
            body:
              preview?.body ??
              controlBody ??
              (demoActive ? personalizeDemoCopy(segBody, c) : segBody),
            isHtml,
            variant: "A",
            step: 0,
            status: "PENDING" as const,
            personalizationStatus: preview?.reviewRequired
              ? ("FAILED" as const)
              : ready
                ? ("READY" as const)
                : ("PENDING" as const),
            ...(preview
              ? {
                  personalizedAt: now,
                  personalizationContextHash: personalizedEmailContextHash({
                    preview: true,
                    contactId: c.id,
                    segment: seg,
                  }),
                  personalizationMeta: {
                    revision: PERSONALIZED_EMAIL_REVISION,
                    mode: preview.reviewRequired
                      ? "recipient_manual_review_required"
                      : preview.manuallyApproved
                        ? "manual_preview_approval"
                        : preview.personalizationMode === "generic"
                          ? "recipient_generic_fallback"
                          : "recipient_preview",
                    usedContextIds: preview.usedContextIds ?? [],
                  },
                  personalizationError: preview.reviewRequired
                    ? "PERSONALIZATION_QUALITY_REJECTED"
                    : preview.personalizationMode === "generic"
                      ? "PERSONALIZATION_CONTEXT_INSUFFICIENT"
                      : null,
                }
              : {}),
          };
        }),
      });
      }
    }
    return ids;
  }, { timeout: 30_000 });

  if (demoActive && canStartNow) {
    for (const campaignId of created)
      await simulateDemoCampaign(campaignId, user.id);
  }

  revalidatePath("/app/campaigns");
  // пачку показываем списком (у каждой кампании своя статистика),
  // одиночную — сразу её карточкой
  revalidatePath("/app/inbox");
  if (onboarding) redirect("/app/setup?s=6");
  redirect(
    created.length > 1 ? "/app/campaigns" : `/app/campaigns/${created[0]}`,
  );
}

// Запуск кампании: раскидывает письма по пулу ящиков клиента (§5.3, M2).
// Запуск только ставит кампанию в очередь. Персональная генерация каждого
// Message выполняется воркером до SMTP и может занимать заметное время на
// больших базах, поэтому Server Action не ждёт её синхронно.
export async function launchCampaign(formData: FormData) {
  const workspace = await requireWorkspace();
  if (
    !can(workspace, "CAMPAIGNS_MANAGE_ALL") &&
    !can(workspace, "CAMPAIGNS_MANAGE_OWN")
  )
    redirect("/app/campaigns");
  const user = workspace.owner;
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  const id = String(formData.get("id"));
  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      userId: user.id,
      isDemo: demoActive,
      ...(can(workspace, "CAMPAIGNS_MANAGE_ALL")
        ? {}
        : { createdById: workspace.actor.id }),
    },
  });
  if (!campaign) return;

  if (campaign.isDemo) {
    const now = new Date();
    if (campaign.scheduledAt && campaign.scheduledAt > now) {
      await prisma.campaign.update({
        where: { id },
        data: { status: "SCHEDULED" },
      });
    } else if (
      campaign.sendAnytime ||
      isWithinSendWindow(now, config.sendWindow)
    ) {
      await simulateDemoCampaign(campaign.id, user.id);
    } else {
      await prisma.campaign.update({
        where: { id },
        data: { status: "QUEUED" },
      });
    }
    revalidatePath(`/app/campaigns/${id}`);
    revalidatePath("/app/campaigns");
    revalidatePath("/app/analytics");
    revalidatePath("/app/inbox");
    revalidatePath("/app/setup");
    return;
  }

  if (!isPlanActive(user.plan, user.planExpiresAt)) {
    redirect(
      `/app/campaigns/${id}?error=${encodeURIComponent("Срок доступа завершён. Запуск и отправка кампаний недоступны до оплаты тарифа.")}`,
    );
  }

  // Гейт прогрева (ТЗ §5.6): без хотя бы одного ящика с warmupState=warm
  // кампания не шлётся. R4: вместо красной ошибки — «Запустить после
  // прогрева»: кампания ждёт, воркер стартует её сам, когда первый ящик
  // станет warm (см. worker.ts).
  const warmMailboxes = await prisma.mailbox.count({
    where: {
      userId: user.id,
      warmupState: "warm",
      connState: { in: ["ok", "paused"] },
    },
  });
  if (warmMailboxes === 0) {
    await prisma.campaign.update({
      where: { id },
      data: { status: "SCHEDULED", launchAfterWarmup: true },
    });
    revalidatePath(`/app/campaigns/${id}`);
    revalidatePath("/app/campaigns");
    revalidatePath("/app/setup");
    return;
  }

  await prisma.campaign.update({
    where: { id },
    data: {
      status:
        campaign.scheduledAt && campaign.scheduledAt > new Date()
          ? "SCHEDULED"
          : "QUEUED",
      launchAfterWarmup: false,
    },
  });

  revalidatePath(`/app/campaigns/${id}`);
  revalidatePath("/app/campaigns");
  revalidatePath("/app/setup");
}

export async function toggleCampaignArchive(formData: FormData) {
  const workspace = await requireWorkspace();
  if (
    !can(workspace, "CAMPAIGNS_MANAGE_ALL") &&
    !can(workspace, "CAMPAIGNS_MANAGE_OWN")
  )
    return;
  const id = String(formData.get("id") || "");
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      userId: workspace.owner.id,
      isDemo: demoActive,
      ...(can(workspace, "CAMPAIGNS_MANAGE_ALL")
        ? {}
        : { createdById: workspace.actor.id }),
    },
    select: { archivedAt: true },
  });
  if (!campaign) return;

  await prisma.campaign.update({
    where: { id },
    data: { archivedAt: campaign.archivedAt ? null : new Date() },
  });
  revalidatePath("/app/campaigns");
  revalidatePath(`/app/campaigns/${id}`);
}
