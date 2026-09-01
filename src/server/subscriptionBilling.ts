import { config } from "@/lib/config";
import { PUBLIC_OFFER_VERSION } from "@/lib/legal";
import { prisma } from "@/lib/prisma";
import { PLANS } from "@/lib/plans";
import { applyDuePlanTransitions, expirePendingPayments } from "@/server/billing";
import {
  chargeSubscription,
  ensurePaymentWebhook,
  isTochkaConfigured,
  TochkaApiError,
} from "@/lib/services/tochka";

export async function processRecurringPayments(limit = 5) {
  await Promise.all([expirePendingPayments(), applyDuePlanTransitions()]);
  if (!isTochkaConfigured()) return { checked: 0, started: 0, failed: 0 };
  const staleBefore = new Date(Date.now() - 30 * 60_000);
  const stale = await prisma.billingSubscription.findMany({
    where: { status: "CHARGING", chargeStartedAt: { lt: staleBefore } },
    select: { id: true },
  });
  if (stale.length) {
    const ids = stale.map((item) => item.id);
    await prisma.$transaction([
      prisma.billingSubscription.updateMany({
        where: { id: { in: ids }, status: "CHARGING" },
        data: { status: "PAST_DUE", chargeStartedAt: null, lastFailureCode: "PAY-CHARGE-TIMEOUT" },
      }),
      prisma.payment.updateMany({
        where: { subscriptionId: { in: ids }, status: "PENDING", kind: "SUBSCRIPTION_RENEWAL" },
        data: { status: "FAILED", failedAt: new Date(), failureCode: "PAY-CHARGE-TIMEOUT" },
      }),
    ]);
  }
  const due = await prisma.billingSubscription.findMany({
    where: { status: "ACTIVE", nextChargeAt: { lte: new Date() } },
    orderBy: { nextChargeAt: "asc" },
    take: limit,
  });
  let started = 0;
  let failed = 0;

  for (const subscription of due) {
    if (!subscription.providerSubscriptionId) continue;
    const chargePlan = subscription.plan;
    const chargeAmount = PLANS[chargePlan].priceRub * 100;
    const payment = await prisma.$transaction(async (tx) => {
      const claimed = await tx.billingSubscription.updateMany({
        where: { id: subscription.id, status: "ACTIVE", nextChargeAt: { lte: new Date() } },
        data: {
          status: "CHARGING",
          chargeStartedAt: new Date(),
          nextChargeAt: null,
          plan: chargePlan,
          amount: chargeAmount,
        },
      });
      if (claimed.count !== 1) return null;
      return tx.payment.create({
        data: {
          userId: subscription.userId,
          provider: "tochka",
          amount: chargeAmount,
          plan: chargePlan,
          status: "PENDING",
          kind: "SUBSCRIPTION_RENEWAL",
          changeType: "RENEW",
          activationMode: "IMMEDIATE",
          previousPlan: subscription.plan,
          subscriptionId: subscription.id,
          offerVersion: subscription.offerVersion || PUBLIC_OFFER_VERSION,
        },
      });
    });
    if (!payment) continue;

    try {
      const result = await chargeSubscription(
        subscription.providerSubscriptionId,
        chargeAmount / 100,
      );
      if (result.Data?.result !== true) {
        throw new TochkaApiError("PAY-CHARGE-REJECTED", "Charge was not accepted");
      }
      started++;
    } catch (error) {
      const code = error instanceof TochkaApiError ? error.code : "PAY-CHARGE";
      console.error(`[billing] recurring charge failed subscription=${subscription.id} code=${code}`, error);
      await prisma.$transaction([
        prisma.billingSubscription.update({
          where: { id: subscription.id },
          data: { status: "PAST_DUE", chargeStartedAt: null, lastFailureCode: code },
        }),
        prisma.payment.update({
          where: { id: payment.id },
          data: { status: "FAILED", failedAt: new Date(), failureCode: code },
        }),
      ]);
      failed++;
    }
  }
  return { checked: due.length, started, failed };
}

export async function syncPaymentWebhook() {
  if (!isTochkaConfigured() || !config.appUrl.startsWith("https://")) return false;
  const url = `${config.appUrl.replace(/\/$/, "")}/api/payments/webhook`;
  await ensurePaymentWebhook(url);
  return true;
}
