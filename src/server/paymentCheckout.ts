import "server-only";

import type { Plan } from "@prisma/client";
import { config } from "@/lib/config";
import { PUBLIC_OFFER_VERSION } from "@/lib/legal";
import { PLANS } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import {
  createOneTimePayment,
  createSubscription,
  isTochkaConfigured,
  TochkaApiError,
} from "@/lib/services/tochka";
import { createPendingPayment, failPayment } from "@/server/billing";

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
}) {
  if (!isTochkaConfigured()) throw new CheckoutError("PAY-1001");

  const plan = PLANS[input.plan];
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
    kind: input.autoRenew ? "SUBSCRIPTION_INITIAL" : "ONE_TIME",
    subscriptionId: subscription?.id,
  });

  const returnBase = `${config.appUrl.replace(/\/$/, "")}/app/billing`;
  const receiptInput = {
    amountRub: plan.priceRub,
    buyerEmail: input.buyerEmail,
    buyerName: input.buyerName,
    paymentId: payment.id,
    planName: plan.name,
    successUrl: `${returnBase}?payment=return`,
    failUrl: `${returnBase}?payment=failed&code=PAY-1002`,
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
