"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateEmailVariants } from "@/lib/services/claude";
import { processCampaign } from "@/server/sendEngine";

// AI генерирует варианты письма на основе онбординга пользователя.
export async function generateVariants(): Promise<
  { subject: string; body: string }[]
> {
  const user = await requireUser();
  return generateEmailVariants({
    offer: user.offer ?? "Наш продукт помогает бизнесу.",
    targetAudience: user.targetAudience ?? "малый и средний бизнес",
    websiteUrl: user.websiteUrl,
    variants: 2,
  });
}

// Создание кампании (черновик) + материализация писем по контактам сегмента.
export async function createCampaign(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") || "Без названия");
  const subject = String(formData.get("subject") || "");
  const body = String(formData.get("body") || "");
  const segment = String(formData.get("segment") || "");
  const senderId = String(formData.get("senderId") || "") || null;

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      name,
      subject,
      body,
      segment: segment || null,
      senderId: senderId || undefined,
      status: "DRAFT",
    },
  });

  // Материализуем письма (по одному на контакт выбранного сегмента)
  const contacts = await prisma.contact.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
      ...(segment ? { segment } : {}),
    },
  });

  if (contacts.length > 0) {
    await prisma.message.createMany({
      data: contacts.map((c) => ({
        campaignId: campaign.id,
        contactId: c.id,
        subject,
        body,
        status: "PENDING" as const,
      })),
    });
  }

  redirect(`/app/campaigns/${campaign.id}`);
}

// Запуск кампании — синхронно отправляет первый batch (dev). Остаток добьёт worker.
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
