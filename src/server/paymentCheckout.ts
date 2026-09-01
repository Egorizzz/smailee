import "server-only";

import type { Plan, PlanActivationMode } from "@prisma/client";
import { config } from "@/lib/config";
import { PUBLIC_OFFER_VERSION } from "@/lib/legal";
import { PLANS } from "@/lib/plans";
import { isPlanActive } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import {
  comparePlans,
  PAYMENT_LINK_TTL_MINUTES,
  paymentLinkExpiresAt,
} from "@/lib/billingPolicy";
import {
  createOneTimePayment,
  createSubscription,
  isTochkaConfigured,
  TochkaApiError,
} from "@/lib/services/tochka";
import {
  applyDuePlanTransitions,
  createPendingPayment,
  expirePendingPayments,
  failPayment,
} from "@/server/billing";

export class CheckoutError extends Error {
  constructor(public readonly publicCode: string) {
    super(publicCode);
    this.name = "CheckoutError";
  }
}

export async function createCheckout(input: {
  userId: string;
  plan: Plan;
  buyerEmail: string;
  buyerName?: string | null;
  autoRenew: boolean;
  activationMode?: PlanActivationMode;
}) {
  if (!isTochkaConfigured()) throw new CheckoutError("PAY-1001");

  const plan = PLANS[input.plan];
  const now = new Date();
  await Promise.all([expirePendingPayments(now), applyDuePlanTransitions(now)]);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: {
      plan: true,
      planExpiresAt: true,
      scheduledPlan: true,
      scheduledPlanExpiresAt: true,
    },
  });
  if (user.scheduledPlan && user.scheduledPlanExpiresAt && user.scheduledPlanExpiresAt > now) {
    throw new CheckoutError("PAY-1004");
  }
  const hasCurrentAccess = isPlanActive(user.plan, user.planExpiresAt, now) && user.plan !== "TRIAL";
  const comparison = hasCurrentAccess ? comparePlans(input.plan, user.plan) : 1;
  const activationMode: PlanActivationMode = hasCurrentAccess
    && user.planExpiresAt
    && user.planExpiresAt > now
    && input.activationMode === "NEXT_PERIOD"
    ? "NEXT_PERIOD"
    : "IMMEDIATE";
  const changeType = !hasCurrentAccess
    ? "ACTIVATE"
    : comparison > 0
      ? "UPGRADE"
      : comparison < 0
        ? "DOWNGRADE"
        : "RENEW";
  const amount = plan.priceRub * 100;
  const kind = input.autoRenew ? "SUBSCRIPTION_INITIAL" : "ONE_TIME";
  const expiresAt = paymentLinkExpiresAt(now);

  const reusable = await prisma.payment.findFirst({
    where: {
      userId: input.userId,
      plan: input.plan,
      amount,
      kind,
      changeType,
      activationMode,
      previousPlan: hasCurrentAccess ? user.plan : null,
      entitlementEndsAt: activationMode === "NEXT_PERIOD" ? user.planExpiresAt : null,
      status: "PENDING",
      expiresAt: { gt: now },
      paymentLink: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { paymentLink: true },
  });
  if (reusable?.paymentLink) return reusable.paymentLink;

  const subscription = input.autoRenew
    ? await prisma.billingSubscription.create({
        data: {
          userId: input.userId,
          plan: input.plan,
          amount: plan.priceRub * 100,
          consentAt: new Date(),
          offerVersion: PUBLIC_OFFER_VERSION,
        },
      })
    : null;

  const payment = await createPendingPayment({
    userId: input.userId,
    plan: input.plan,
    provider: "tochka",
    kind,
    subscriptionId: subscription?.id,
    amount,
    changeType,
    activationMode,
    previousPlan: hasCurrentAccess ? user.plan : undefined,
    entitlementEndsAt: activationMode === "NEXT_PERIOD"
      ? user.planExpiresAt ?? undefined
      : undefined,
    expiresAt,
  });

  const returnBase = `${config.appUrl.replace(/\/$/, "")}/app/billing`;
  const receiptInput = {
    amountRub: amount / 100,
    buyerEmail: input.buyerEmail,
    buyerName: input.buyerName,
    paymentId: payment.id,
    planName: plan.name,
    successUrl: `${returnBase}?payment=return&id=${encodeURIComponent(payment.id)}`,
    failUrl: `${returnBase}?payment=failed&code=PAY-1002&id=${encodeURIComponent(payment.id)}`,
    ttlMinutes: PAYMENT_LINK_TTL_MINUTES,
  };

  try {
    const checkout = input.autoRenew
      ? await createSubscription(receiptInput)
      : await createOneTimePayment(receiptInput);
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { externalId: checkout.operationId, paymentLink: checkout.paymentLink },
      }),
      ...(subscription
        ? [
            prisma.billingSubscription.update({
              where: { id: subscription.id },
              data: { providerSubscriptionId: checkout.operationId },
            }),
          ]
        : []),
    ]);
    return checkout.paymentLink;
  } catch (error) {
    const internalCode = error instanceof TochkaApiError ? error.code : "PAY-CHECKOUT";
    console.error(`[billing] checkout failed payment=${payment.id} code=${internalCode}`, error);
    await failPayment(payment.id, internalCode).catch(() => {});
    if (subscription) {
      await prisma.billingSubscription.update({
        where: { id: subscription.id },
        data: { status: "FAILED", lastFailureCode: internalCode },
      }).catch(() => {});
    }
    throw new CheckoutError("PAY-1002");
  }
}
