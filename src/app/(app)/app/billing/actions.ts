"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/organization";
import { createPendingPayment } from "@/server/billing";
import type { Plan } from "@prisma/client";
import { PAID_PLAN_KEYS } from "@/lib/plans";
import { hasAcceptedCurrentUserAgreement } from "@/lib/legal";

/**
 * Начало оплаты тарифа.
 * Сейчас: создаёт PENDING-платёж и (пока шлюз не подключён) возвращает его id.
 * После подключения ЮMoney: здесь формируется ссылка на оплату
 * (quickpay/форма) с label=payment.id, и пользователь редиректится на шлюз.
 * Подтверждение придёт в /api/payments/webhook.
 */
export async function startPayment(formData: FormData) {
  const { owner: user, actor } = await requireCapability("BILLING_MANAGE");
  const plan = String(formData.get("plan")) as Plan;
  if (!(PAID_PLAN_KEYS as readonly string[]).includes(plan)) return;

  // Пользовательское соглашение принимает каждый сотрудник явно. Публичная
  // оферта акцептуется плательщиком оплатой и фиксируется в записи Payment.
  if (!hasAcceptedCurrentUserAgreement(actor)) redirect("/accept-terms");

  await createPendingPayment({
    userId: user.id,
    plan,
    provider: "yoomoney",
  });

  revalidatePath("/app/billing");
}
