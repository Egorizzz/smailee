"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { notifySetupRequest } from "@/server/notifications";
import { queueSetupRequestTelegramNotification } from "@/server/adminTelegramNotifications";
import { z } from "zod";

const controlContactSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(200).optional(),
});

const setupStepSchema = z.coerce.number().int().min(1).max(7);

export async function skipSetupStep(formData: FormData) {
  const { owner: user } = await requireOrganizationAdmin();
  const parsed = setupStepSchema.safeParse(formData.get("step"));
  if (!parsed.success) redirect("/app/setup");
  const skipped = [...new Set([...user.setupSkippedSteps, parsed.data])].sort((a, b) => a - b);
  await prisma.user.update({ where: { id: user.id }, data: { setupSkippedSteps: skipped } });
  revalidatePath("/app/setup");
  redirect(`/app/setup?s=${Math.min(8, parsed.data + 1)}`);
}

export async function completeContactsReview() {
  const { owner: user } = await requireOrganizationAdmin();
  await prisma.user.update({
    where: { id: user.id },
    data: { setupReviewedContactsAt: new Date() },
  });
  revalidatePath("/app/setup");
  redirect("/app/setup?s=4");
}


export async function saveControlContact(formData: FormData) {
  const { owner: user } = await requireOrganizationAdmin();
  const parsed = controlContactSchema.safeParse({ email: formData.get("email"), name: formData.get("name") || undefined });
  if (!parsed.success) redirect(`/app/setup?s=5&error=${encodeURIComponent("Укажите корректный email")}`);
  await prisma.contact.upsert({
    where: { userId_email: { userId: user.id, email: parsed.data.email } },
    create: { userId: user.id, email: parsed.data.email, name: parsed.data.name || "Контрольный контакт", segment: "Личный адрес", source: "ONBOARDING_CONTROL", isControl: true },
    update: { name: parsed.data.name || "Контрольный контакт", segment: "Личный адрес", isControl: true },
  });
  revalidatePath("/app/setup");
  redirect("/app/setup?s=6");
}

// Вернуться в визард из баннера в «Аналитике».
export async function reopenSetup() {
  const { owner: user } = await requireOrganizationAdmin();
  await prisma.user.update({
    where: { id: user.id },
    data: { setupClosedAt: null },
  });
  redirect("/app/setup");
}

async function completeSetup(destination: string) {
  const { owner: user } = await requireOrganizationAdmin();
  await prisma.user.update({
    where: { id: user.id },
    data: { setupClosedAt: new Date() },
  });
  redirect(destination);
}

// Финальный экран не запускает оплату: он лишь фиксирует завершение первого
// пути и переводит пользователя к осознанному выбору тарифа или в продукт.
export async function chooseWorkingPlan() {
  await completeSetup("/app/billing?source=onboarding");
}

export async function continueExploringSmailee() {
  await completeSetup("/app/analytics?onboarding=complete");
}

// «Настройте всё за меня»: заявка в БД (видна в админке) + письмо оператору
// best-effort (см. notifySetupRequest). После — визард закрывается.
export async function requestSetupHelp(formData: FormData) {
  const { owner: user } = await requireOrganizationAdmin();
  const name = String(formData.get("name") || "").trim();
  const contact = String(formData.get("contact") || "").trim();
  const preferredTime = String(formData.get("preferredTime") || "").trim() || null;

  if (!name || !contact) {
    redirect(`/app/setup?help=1&error=${encodeURIComponent("Укажите имя и контакт для связи")}`);
  }

  const setupRequest = await prisma.setupRequest.create({
    data: { userId: user.id, name, contact, preferredTime },
  });
  await queueSetupRequestTelegramNotification({
    id: setupRequest.id,
    userEmail: user.email,
    name,
    contact,
    preferredTime,
  }).catch((error) => {
    console.error("[setup] не удалось поставить Telegram-уведомление в очередь:", error);
  });
  await notifySetupRequest({ userEmail: user.email, name, contact, preferredTime });

  await prisma.user.update({
    where: { id: user.id },
    data: { setupClosedAt: new Date() },
  });
  redirect("/app/analytics?setupRequested=1");
}
