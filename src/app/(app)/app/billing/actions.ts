"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createPendingPayment } from "@/server/billing";
import type { Plan } from "@prisma/client";

/**
 * Начало оплаты тарифа.
 * Сейчас: создаёт PENDING-платёж и (пока шлюз не подключён) возвращает его id.
 * После подключения ЮMoney: здесь формируется ссылка на оплату
 * (quickpay/форма) с label=payment.id, и пользователь редиректится на шлюз.
 * Подтверждение придёт в /api/payments/webhook.
 */
export async function startPayment(formData: FormData) {
  const user = await requireUser();
  const plan = String(formData.get("plan")) as Plan;
  if (plan !== "START" && plan !== "PRO") return;

  // оферта обязательна до оплаты
  if (!user.acceptedTermsAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { acceptedTermsAt: new Date() },
    });
  }

  await createPendingPayment({
    userId: user.id,
    plan,
    provider: "yoomoney",
  });

  revalidatePath("/app/billing");
}
