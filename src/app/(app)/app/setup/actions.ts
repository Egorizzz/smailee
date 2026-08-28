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

export async function saveControlContact(formData: FormData) {
  const { owner: user } = await requireOrganizationAdmin();
  const parsed = controlContactSchema.safeParse({ email: formData.get("email"), name: formData.get("name") || undefined });
  if (!parsed.success) redirect(`/app/setup?s=4&error=${encodeURIComponent("Укажите корректный email")}`);
  const latestContact = await prisma.contact.findFirst({
    where: { userId: user.id, isDemo: false, isControl: false },
    orderBy: { createdAt: "desc" },
    select: { segment: true },
  });
  await prisma.contact.upsert({
    where: { userId_email: { userId: user.id, email: parsed.data.email } },
    create: { userId: user.id, email: parsed.data.email, name: parsed.data.name || "Контрольный контакт", segment: latestContact?.segment ?? "Сегмент не определён", source: "ONBOARDING_CONTROL", isControl: true },
    update: { name: parsed.data.name || "Контрольный контакт", segment: latestContact?.segment ?? "Сегмент не определён", isControl: true },
  });
  revalidatePath("/app/setup");
  redirect("/app/setup?s=5");
}

// ✕ на визарде: онбординг можно закрыть в любой момент — дальше главная
// ведёт в «Аналитику», где остаётся баннер «Продолжить настройку».
export async function closeSetup() {
  const { owner: user } = await requireOrganizationAdmin();
  await prisma.user.update({
    where: { id: user.id },
    data: { setupClosedAt: new Date() },
  });
  redirect("/app/analytics");
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
