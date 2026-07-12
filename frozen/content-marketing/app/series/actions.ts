"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSeriesPlan, generateStepContent, materializeDueSteps } from "@/server/contentCampaign";
import { processCampaign } from "@/server/sendEngine";
import type { LlmProvider } from "@/lib/services/llm";

export async function createSeriesCampaign(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") || "Серия контент-маркетинга");
  const topic = String(formData.get("topic") || "").trim();
  const totalSteps = Math.max(1, Math.min(20, Number(formData.get("totalSteps") || 5)));
  const frequencyDays = Math.max(1, Math.min(30, Number(formData.get("frequencyDays") || 3)));
  const segment = String(formData.get("segment") || "") || null;
  const senderId = String(formData.get("senderId") || "") || null;

  if (!topic) {
    redirect(`/app/campaigns/series/new?error=${encodeURIComponent("Укажите тему серии")}`);
  }

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      type: "SERIES",
      name,
      // Campaign.subject/body у SERIES не используются при отправке (контент — в
      // ContentStep для каждого шага), но поля обязательны в схеме — держим для
      // читаемости в общем списке кампаний.
      subject: topic,
      body: "",
      segment: segment ?? undefined,
      senderId: senderId ?? undefined,
      seriesTopic: topic,
      seriesTotalSteps: totalSteps,
      seriesFrequencyDays: frequencyDays,
      status: "DRAFT",
    },
  });

  redirect(`/app/campaigns/series/${campaign.id}`);
}

async function assertOwnership(campaignId: string) {
  const user = await requireUser();
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId: user.id },
  });
  if (!campaign) throw new Error("Кампания не найдена");
  return campaign;
}

export async function planSeries(campaignId: string, provider?: LlmProvider) {
  await assertOwnership(campaignId);
  const result = await createSeriesPlan(campaignId, provider);
  revalidatePath(`/app/campaigns/series/${campaignId}`);
  return result;
}

export async function generateStep(
  contentStepId: string,
  campaignId: string,
  provider?: LlmProvider
) {
  await assertOwnership(campaignId);
  const result = await generateStepContent(contentStepId, provider);
  revalidatePath(`/app/campaigns/series/${campaignId}`);
  return result;
}

export async function launchSeries(campaignId: string) {
  const campaign = await assertOwnership(campaignId);

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "QUEUED", startedAt: campaign.startedAt ?? new Date() },
  });

  // Dev-удобство: не ждём тика воркера — сразу материализуем и шлём первую волну
  // (тот же приём, что и launchCampaign делает для обычных кампаний).
  await materializeDueSteps();
  await processCampaign(campaignId);

  revalidatePath(`/app/campaigns/series/${campaignId}`);
  revalidatePath("/app/campaigns");
}
