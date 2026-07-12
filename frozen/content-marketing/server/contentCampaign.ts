
import { prisma } from "@/lib/prisma";
import * as llm from "@/lib/services/llm";
import type { LlmProvider } from "@/lib/services/llm";
import * as falai from "@/lib/services/falai";
import { renderContentEmailHtml } from "@/lib/contentEmailTemplate";

/**
 * Оркестрация серий контент-маркетинга: планирование тем (LLM) → генерация
 * текста + промпта картинки (LLM) → генерация картинки (fal.ai, отдельный
 * HTTP-вызов на сервере, ключ модели не видит) → сборка HTML по шаблону →
 * материализация писем по расписанию → авто-касание высоко вовлечённых.
 */

const HIGH_ENGAGEMENT_MIN_SENT = 2;
const HIGH_ENGAGEMENT_OPEN_RATIO = 0.5;
const PERSONAL_NUDGE_STEP = 900; // маркер step, отличающий персональные касания от шагов серии

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

/** Планирует темы/ракурсы/расписание серии и создаёт ContentStep-записи (DRAFT). */
export async function createSeriesPlan(
  campaignId: string,
  provider?: LlmProvider
): Promise<{ steps: number; notice?: string }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { user: true },
  });
  if (!campaign || campaign.type !== "SERIES") {
    throw new Error("Кампания не найдена или не является серией");
  }
  if (!campaign.seriesTopic || !campaign.seriesTotalSteps || !campaign.seriesFrequencyDays) {
    throw new Error("У серии не заданы тема/число писем/частота");
  }

  const outcome = await llm.planContentSeries(
    {
      topic: campaign.seriesTopic,
      targetAudience: campaign.user.targetAudience ?? "малый и средний бизнес",
      offer: campaign.user.offer ?? "Наш продукт помогает бизнесу.",
      totalSteps: campaign.seriesTotalSteps,
      frequencyDays: campaign.seriesFrequencyDays,
    },
    provider
  );

  await prisma.$transaction(
    outcome.data.map((step) =>
      prisma.contentStep.upsert({
        where: { campaignId_stepIndex: { campaignId, stepIndex: step.stepIndex } },
        create: {
          campaignId,
          stepIndex: step.stepIndex,
          topic: step.topic,
          angle: step.angle,
          dayOffset: step.dayOffset,
          includeCta: step.includeCta,
          ctaLabel: step.ctaLabel ?? null,
        },
        update: {
          topic: step.topic,
          angle: step.angle,
          dayOffset: step.dayOffset,
          includeCta: step.includeCta,
          ctaLabel: step.ctaLabel ?? null,
        },
      })
    )
  );

  return { steps: outcome.data.length, notice: outcome.notice };
}

/** Пишет текст конкретного шага, генерирует картинку и собирает готовый HTML. */
export async function generateStepContent(
  contentStepId: string,
  provider?: LlmProvider
): Promise<{ notice?: string }> {
  const step = await prisma.contentStep.findUnique({
    where: { id: contentStepId },
    include: { campaign: { include: { user: true } } },
  });
  if (!step) throw new Error("Шаг серии не найден");

  const draft = await llm.draftContentEmail(
    {
      topic: step.topic,
      angle: step.angle,
      offer: step.campaign.user.offer ?? "Наш продукт помогает бизнесу.",
      includeCta: step.includeCta,
      ctaLabel: step.ctaLabel ?? undefined,
    },
    provider
  );

  let imageUrl: string | null = null;
  let notice = draft.notice;
  try {
    const image = await falai.generateImage(draft.data.imagePrompt, {
      userId: step.campaign.userId,
    });
    imageUrl = image.url;
  } catch (err) {
    console.error(`[contentCampaign] generateImage failed for step ${contentStepId}:`, err);
    notice = notice ?? "Не удалось сгенерировать картинку (см. логи) — письмо готово без иллюстрации.";
  }

  const html = renderContentEmailHtml({
    subject: draft.data.subject,
    bodyText: draft.data.bodyText,
    imageUrl,
    includeCta: step.includeCta,
    ctaLabel: step.ctaLabel,
  });

  await prisma.contentStep.update({
    where: { id: contentStepId },
    data: {
      subject: draft.data.subject,
      body: html,
      imagePrompt: draft.data.imagePrompt,
      imageUrl,
      status: "READY",
    },
  });

  return { notice };
}

/**
 * Вызывается воркером: для запущенных серий материализует Message на все
 * ACTIVE-контакты сегмента для шагов, чей срок настал и текст уже готов (READY).
 * Аналог processFollowups в sendEngine.ts, но для писем серии, а не follow-up.
 */
export async function materializeDueSteps(): Promise<number> {
  const campaigns = await prisma.campaign.findMany({
    where: { type: "SERIES", status: { in: ["QUEUED", "SENDING"] }, startedAt: { not: null } },
    include: { contentSteps: { orderBy: { stepIndex: "asc" } } },
  });

  let created = 0;
  for (const campaign of campaigns) {
    const elapsed = daysSince(campaign.startedAt!);
    // берём по порядку: первый ещё не отправленный шаг. Если он не READY (текст не
    // сгенерирован) — ждём, дальше по очереди не забегаем.
    const nextStep = campaign.contentSteps.find((s) => s.status !== "SENT");
    if (!nextStep || nextStep.status !== "READY" || nextStep.dayOffset > elapsed) continue;

    const contacts = await prisma.contact.findMany({
      where: {
        userId: campaign.userId,
        status: "ACTIVE",
        ...(campaign.segment ? { segment: campaign.segment } : {}),
      },
    });

    if (contacts.length > 0) {
      await prisma.message.createMany({
        data: contacts.map((c) => ({
          campaignId: campaign.id,
          contactId: c.id,
          contentStepId: nextStep.id,
          subject: nextStep.subject!,
          body: nextStep.body!,
          isHtml: true,
          step: nextStep.stepIndex,
          status: "PENDING" as const,
        })),
      });
      created += contacts.length;
    }

    await prisma.contentStep.update({
      where: { id: nextStep.id },
      data: { status: "SENT", sentAt: new Date() },
    });

    // если это был последний шаг серии — кампания больше не ждёт новых волн
    const allSent = campaign.contentSteps.every(
      (s) => s.id === nextStep.id || s.status === "SENT"
    );
    if (allSent) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENT" } });
    }
  }
  return created;
}

/**
 * Вызывается воркером: находит контактов с высоким open rate по уже отправленным
 * шагам серии и запускает для них персональное касание (одно на контакт+кампанию).
 */
export async function processHighEngagementContacts(): Promise<number> {
  const campaigns = await prisma.campaign.findMany({
    where: { type: "SERIES", status: { in: ["QUEUED", "SENDING"] } },
    include: { user: true },
  });

  let nudged = 0;
  for (const campaign of campaigns) {
    const messages = await prisma.message.findMany({
      where: { campaignId: campaign.id, contentStepId: { not: null } },
      include: { contact: true },
    });

    const byContact = new Map<string, typeof messages>();
    for (const m of messages) {
      if (!byContact.has(m.contactId)) byContact.set(m.contactId, []);
      byContact.get(m.contactId)!.push(m);
    }

    for (const [contactId, msgs] of byContact) {
      const sent = msgs.filter((m) => m.status !== "PENDING");
      if (sent.length < HIGH_ENGAGEMENT_MIN_SENT) continue;
      const opened = sent.filter((m) => m.openedAt);
      if (opened.length / sent.length < HIGH_ENGAGEMENT_OPEN_RATIO) continue;

      const alreadyNudged = await prisma.message.findFirst({
        where: { campaignId: campaign.id, contactId, isPersonalNudge: true },
      });
      if (alreadyNudged) continue;

      const contact = msgs[0].contact;
      const nudge = await llm.generatePersonalNudge({
        topic: campaign.seriesTopic ?? "тема серии",
        offer: campaign.user.offer ?? "Наш продукт помогает бизнесу.",
        contactName: contact.name,
      });

      await prisma.message.create({
        data: {
          campaignId: campaign.id,
          contactId,
          subject: `Вопрос по теме «${campaign.seriesTopic}»`,
          body: nudge.data,
          isHtml: false,
          step: PERSONAL_NUDGE_STEP,
          status: "PENDING",
          isPersonalNudge: true,
        },
      });
      nudged++;
    }
  }
  return nudged;
}
