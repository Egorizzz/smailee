/**
 * Billing: подтверждение платежей и активация тарифов.
 * Вебхук платёжного шлюза только парсит запрос и вызывает confirmPayment().
 * Смена банковского адаптера не затрагивает эту логику.
 */
import { prisma } from "@/lib/prisma";
import type { PaymentKind, Plan } from "@prisma/client";
import { PLANS } from "@/lib/plans";
import { PUBLIC_OFFER_VERSION } from "@/lib/legal";
import { cancelPendingPlanNotifications } from "@/server/planNotifications";

const PLAN_DURATION_DAYS = 30;
const FIRST_PAYMENT_DURATION_DAYS = 45;

/** Создаёт ожидающий платёж (перед редиректом на оплату). */
export async function createPendingPayment(input: {
  userId: string;
  plan: Plan;
  provider: string;
  externalId?: string;
  kind?: PaymentKind;
  subscriptionId?: string;
}) {
  return prisma.payment.create({
    data: {
      userId: input.userId,
      plan: input.plan,
      provider: input.provider,
      externalId: input.externalId,
      kind: input.kind,
      subscriptionId: input.subscriptionId,
      amount: PLANS[input.plan].priceRub * 100, // копейки
      status: "PENDING",
      offerVersion: PUBLIC_OFFER_VERSION,
    },
  });
}

/**
 * Подтверждение платежа (из вебхука шлюза или вручную админом).
 * Идемпотентно: повторное подтверждение не продлевает план дважды.
 * Первый подтверждённый платёж открывает 45 дней доступа: дополнительные
 * 15 дней покрывают прогрев новых ящиков. Каждый следующий платёж добавляет
 * 30 дней к ещё не истёкшему доступу либо начинает новый период с момента
 * подтверждения. Поэтому продление и смена тарифа не сжигают оплаченные дни.
 * От этого же момента заново считаются тарифные квоты.
 */
export async function confirmPayment(paymentId: string) {
  const initialPayment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { userId: true },
  });
  if (!initialPayment) throw new Error("payment not found");

  const result = await prisma.$transaction(async (tx) => {
    // Сериализуем подтверждения одного клиента: два разных webhook не должны
    // одновременно посчитать себя первой оплатой и выдать по 45 дней.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${initialPayment.userId} FOR UPDATE`;

    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("payment not found");
    if (payment.status === "CONFIRMED") return { payment, newlyConfirmed: false };

    const [confirmedPayments, user] = await Promise.all([
      tx.payment.count({
        where: { userId: payment.userId, status: "CONFIRMED" },
      }),
      tx.user.findUniqueOrThrow({
        where: { id: payment.userId },
        select: { planExpiresAt: true },
      }),
    ]);
    const durationDays = confirmedPayments === 0 ? FIRST_PAYMENT_DURATION_DAYS : PLAN_DURATION_DAYS;
    const confirmedAt = new Date();
    const periodStartsAt = user.planExpiresAt && user.planExpiresAt > confirmedAt
      ? user.planExpiresAt
      : confirmedAt;
    const expiresAt = new Date(periodStartsAt);
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: { status: "CONFIRMED", confirmedAt, failedAt: null, failureCode: null },
    });
    await tx.user.update({
      where: { id: payment.userId },
      data: { plan: payment.plan, planExpiresAt: expiresAt, isDemo: false },
    });

    let subscriptionsToCancel: string[] = [];
    if (payment.subscriptionId) {
      const subscription = await tx.billingSubscription.findUnique({
        where: { id: payment.subscriptionId },
      });
      if (subscription) {
        const cancelled = subscription.status === "CANCELLED";
        await tx.billingSubscription.update({
          where: { id: subscription.id },
          data: {
            status: cancelled ? "CANCELLED" : "ACTIVE",
            activatedAt: subscription.activatedAt ?? confirmedAt,
            nextChargeAt: cancelled ? null : expiresAt,
            chargeStartedAt: null,
            lastFailureCode: null,
          },
        });
        if (payment.kind === "SUBSCRIPTION_INITIAL") {
          const previous = await tx.billingSubscription.findMany({
            where: {
              userId: payment.userId,
              id: { not: subscription.id },
              status: { in: ["ACTIVE", "CHARGING", "PAST_DUE"] },
            },
            select: { id: true, providerSubscriptionId: true },
          });
          subscriptionsToCancel = previous.flatMap((item) =>
            item.providerSubscriptionId ? [item.providerSubscriptionId] : [],
          );
          await tx.billingSubscription.updateMany({
            where: { id: { in: previous.map((item) => item.id) } },
            data: { status: "CANCELLED", cancelledAt: confirmedAt, nextChargeAt: null },
          });
        }
      }
    } else if (payment.kind === "ONE_TIME" && payment.provider === "tochka") {
      const existing = await tx.billingSubscription.findMany({
        where: { userId: payment.userId, status: { in: ["ACTIVE", "CHARGING", "PAST_DUE"] } },
        select: { id: true, providerSubscriptionId: true },
      });
      subscriptionsToCancel = existing.flatMap((item) =>
        item.providerSubscriptionId ? [item.providerSubscriptionId] : [],
      );
      await tx.billingSubscription.updateMany({
        where: { id: { in: existing.map((item) => item.id) } },
        data: { status: "CANCELLED", cancelledAt: confirmedAt, nextChargeAt: null },
      });
    }
    return { payment: updated, newlyConfirmed: true, subscriptionsToCancel };
  });

  if (result.newlyConfirmed) {
    await cancelPendingPlanNotifications(initialPayment.userId);
    if (result.subscriptionsToCancel?.length) {
      const { cancelProviderSubscription } = await import("@/lib/services/tochka");
      await Promise.allSettled(
        result.subscriptionsToCancel.map((operationId) => cancelProviderSubscription(operationId)),
      );
    }
  }
  return result.payment;
}

/** Поиск платежа по внешнему id шлюза (для вебхука). */
export async function findPaymentByExternalId(externalId: string) {
  return prisma.payment.findFirst({ where: { externalId } });
}

export async function failPayment(paymentId: string, failureCode: string) {
  return prisma.payment.updateMany({
    where: { id: paymentId, status: "PENDING" },
    data: { status: "FAILED", failedAt: new Date(), failureCode },
  });
}

/**
 * Одноразовый self-service демо-доступ: лимиты START на 14 дней.
 * Не создаёт платёж и не продлевает уже действующий либо оплаченный тариф.
 */

/** Ручная смена плана админом (без платежа). */
export async function adminSetPlan(userId: string, plan: Plan, days = 30) {
  const now = new Date();
  const expiresAt =
    plan === "TRIAL" ? null : new Date(now.getTime() + days * 24 * 3600 * 1000);
  const result = await prisma.$transaction(async (tx) => {
    const subscriptions = await tx.billingSubscription.findMany({
      where: { userId, status: { in: ["ACTIVE", "CHARGING", "PAST_DUE", "PENDING"] } },
      select: { id: true, providerSubscriptionId: true },
    });
    const updated = await tx.user.update({
      where: { id: userId },
      data: { plan, planExpiresAt: expiresAt, isDemo: false },
    });
    await tx.billingSubscription.updateMany({
      where: { id: { in: subscriptions.map((item) => item.id) } },
      data: { status: "CANCELLED", cancelledAt: now, nextChargeAt: null },
    });
    await cancelPendingPlanNotifications(userId, now, tx);
    return {
      updated,
      providerIds: subscriptions.flatMap((item) =>
        item.providerSubscriptionId ? [item.providerSubscriptionId] : [],
      ),
    };
  });
  if (result.providerIds.length) {
    const { cancelProviderSubscription } = await import("@/lib/services/tochka");
    await Promise.allSettled(result.providerIds.map((id) => cancelProviderSubscription(id)));
  }
  return result.updated;
}

/** Продлевает именно демо тарифа «Стандартный» от текущего срока или от сегодня. */
