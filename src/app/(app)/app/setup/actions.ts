"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifySetupRequest } from "@/server/notifications";

// ✕ на визарде: онбординг можно закрыть в любой момент — дальше главная
// ведёт в «Лиды», а на них висит баннер «Продолжить настройку».
export async function closeSetup() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { setupClosedAt: new Date() },
  });
  redirect("/app/leads");
}

// Вернуться в визард из баннера на «Лидах».
export async function reopenSetup() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { setupClosedAt: null },
  });
  redirect("/app/setup");
}

// Шаг 1: о бизнесе (те же поля, что в Настройках, но с переходом дальше).
export async function saveBusinessStep(formData: FormData) {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      companyName: String(formData.get("companyName") || "") || null,
      websiteUrl: String(formData.get("websiteUrl") || "") || null,
      offer: String(formData.get("offer") || "") || null,
      targetAudience: String(formData.get("targetAudience") || "") || null,
    },
  });
  revalidatePath("/app/setup");
  redirect("/app/setup");
}

// «Настройте всё за меня»: заявка в БД (видна в админке) + письмо оператору
// best-effort (см. notifySetupRequest). После — визард закрывается.
export async function requestSetupHelp(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  const contact = String(formData.get("contact") || "").trim();
  const preferredTime = String(formData.get("preferredTime") || "").trim() || null;

  if (!name || !contact) {
    redirect(`/app/setup?help=1&error=${encodeURIComponent("Укажите имя и контакт для связи")}`);
  }

  await prisma.setupRequest.create({
    data: { userId: user.id, name, contact, preferredTime },
  });
  await notifySetupRequest({ userEmail: user.email, name, contact, preferredTime });

  await prisma.user.update({
    where: { id: user.id },
    data: { setupClosedAt: new Date() },
  });
  redirect("/app/leads?setupRequested=1");
}
