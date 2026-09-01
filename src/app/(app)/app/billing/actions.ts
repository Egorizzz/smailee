"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/organization";
import type { Plan, PlanActivationMode } from "@prisma/client";
import { PAID_PLAN_KEYS } from "@/lib/plans";
import { hasAcceptedCurrentUserAgreement } from "@/lib/legal";
import { CheckoutError, createCheckout } from "@/server/paymentCheckout";
import { prisma } from "@/lib/prisma";
import { cancelProviderSubscription } from "@/lib/services/tochka";

/**
 * Начало оплаты тарифа.
 * Создаёт ожидающий платёж и переводит пользователя на защищённую страницу
 * банка. Доступ активирует только подписанный webhook после успешной оплаты.
 */
export async function startPayment(formData: FormData) {
  const { owner: user, actor, organizationName } = await requireCapability("BILLING_MANAGE");
  const plan = String(formData.get("plan")) as Plan;
  if (!(PAID_PLAN_KEYS as readonly string[]).includes(plan)) return;
  const activationMode: PlanActivationMode = formData.get("activationMode") === "NEXT_PERIOD"
    ? "NEXT_PERIOD"
    : "IMMEDIATE";

  // Пользовательское соглашение принимает каждый сотрудник явно. Публичная
  // оферта акцептуется плательщиком оплатой и фиксируется в записи Payment.
  if (!hasAcceptedCurrentUserAgreement(actor)) redirect("/accept-terms");

  let paymentLink: string;
  try {
    paymentLink = await createCheckout({
      userId: user.id,
      plan,
      buyerEmail: actor.email,
      buyerName: actor.name || organizationName,
      autoRenew: formData.get("autoRenew") === "on",
      activationMode,
    });
  } catch (error) {
    if (error instanceof CheckoutError) {
      redirect(`/app/billing?payment=failed&code=${encodeURIComponent(error.publicCode)}`);
    }
    throw error;
  }

  redirect(paymentLink);
}

export async function cancelAutoRenewal() {
  const { owner: user } = await requireCapability("BILLING_MANAGE");
  const subscription = await prisma.billingSubscription.findFirst({
    where: { userId: user.id, status: { in: ["ACTIVE", "CHARGING", "PAST_DUE", "PENDING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!subscription) return;

  const cancelledAt = new Date();
  await prisma.billingSubscription.update({
    where: { id: subscription.id },
    data: { status: "CANCELLED", cancelledAt, nextChargeAt: null },
  });
  await prisma.user.updateMany({
    where: { id: user.id, scheduledPlanExpiresAt: null },
    data: { scheduledPlan: null, scheduledPlanAt: null, scheduledPlanExpiresAt: null },
  });

  if (subscription.providerSubscriptionId) {
    try {
      await cancelProviderSubscription(subscription.providerSubscriptionId);
      await prisma.billingSubscription.update({
        where: { id: subscription.id },
        data: { providerCancelledAt: new Date() },
      });
    } catch (error) {
      console.error(`[billing] provider cancellation failed subscription=${subscription.id}`, error);
    }
  }
  revalidatePath("/app/billing");
}
