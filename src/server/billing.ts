/**
 * Billing: подтверждение платежей и активация тарифов.
 * Вебхук платёжного шлюза только парсит запрос и вызывает confirmPayment().
 * Смена банковского адаптера не затрагивает эту логику.
 */
import { prisma } from "@/lib/prisma";
import type {
  PaymentKind,
  Plan,
  PlanActivationMode,
  PlanChangeType,
} from "@prisma/client";
import { PLANS } from "@/lib/plans";
import { PUBLIC_OFFER_VERSION } from "@/lib/legal";
import {
  expectedPaidPlanExpiry,
  FIRST_PAID_PERIOD_DURATION_DAYS,
  PAID_PERIOD_DURATION_DAYS,
} from "@/lib/billingPeriods";
import { cancelPendingPlanNotifications } from "@/server/planNotifications";
import { paymentLinkExpiresAt } from "@/lib/billingPolicy";

/** Создаёт ожидающий платёж (перед редиректом на оплату). */
export async function createPendingPayment(input: {
  userId: string;
  plan: Plan;
  provider: string;
  externalId?: string;
  kind?: PaymentKind;
  subscriptionId?: string;
  amount?: number;
  changeType?: PlanChangeType;
  activationMode?: PlanActivationMode;
  previousPlan?: Plan;
  entitlementEndsAt?: Date;
  expiresAt?: Date;
}) {
  return prisma.payment.create({
    data: {
      userId: input.userId,
      plan: input.plan,
      provider: input.provider,
      externalId: input.externalId,
      kind: input.kind,
      subscriptionId: input.subscriptionId,
      amount: input.amount ?? PLANS[input.plan].priceRub * 100, // копейки
      status: "PENDING",
      changeType: input.changeType,
      activationMode: input.activationMode ?? "IMMEDIATE",
      previousPlan: input.previousPlan,
      entitlementEndsAt: input.entitlementEndsAt,
      expiresAt: input.expiresAt ?? paymentLinkExpiresAt(),
      offerVersion: PUBLIC_OFFER_VERSION,
    },
  });
}

/**
 * Подтверждение платежа из подписанного webhook шлюза.
 * Идемпотентно: повторное подтверждение не продлевает план дважды.
 * Первая покупка после пробного тарифа открывает 45 дней доступа: дополнительные
 * 15 дней покрывают прогрев новых ящиков. Любой переход с уже действующего
 * тарифа покупает полный 30-дневный период без пропорций. IMMEDIATE запускает
 * его и новые квоты в момент подтверждения; NEXT_PERIOD сохраняет текущие
 * тариф и квоты до даты окончания и активирует предоплаченный период затем.
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
        select: {
          plan: true,
          planExpiresAt: true,
        },
      }),
    ]);
    const durationDays = confirmedPayments === 0 && payment.changeType === "ACTIVATE"
      ? FIRST_PAID_PERIOD_DURATION_DAYS
      : PAID_PERIOD_DURATION_DAYS;
    const confirmedAt = new Date();
    const expiresAt = new Date(confirmedAt);
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    const requestedStart = payment.entitlementEndsAt && payment.entitlementEndsAt > confirmedAt
      ? payment.entitlementEndsAt
      : null;
    const currentPeriodEnd = payment.previousPlan === user.plan
      && user.planExpiresAt
      && user.planExpiresAt > confirmedAt
      ? user.planExpiresAt
      : null;
    // Старые ссылки не содержат activationMode: до появления выбора они
    // продлевали действующий доступ после его окончания.
    const shouldUseNextPeriod = payment.activationMode === "NEXT_PERIOD"
      || (payment.activationMode === null && Boolean(currentPeriodEnd));
    const scheduledStartsAt = shouldUseNextPeriod
      ? [requestedStart, currentPeriodEnd]
          .filter((value): value is Date => Boolean(value))
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? null
      : null;
    const shouldSchedule = Boolean(scheduledStartsAt && scheduledStartsAt > confirmedAt);
    const scheduledExpiresAt = shouldSchedule ? new Date(scheduledStartsAt!) : null;
    scheduledExpiresAt?.setDate(scheduledExpiresAt.getDate() + durationDays);

    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "CONFIRMED",
        confirmedAt,
        failedAt: null,
        failureCode: null,
        expiredAt: null,
      },
    });
    await tx.user.update({
      where: { id: payment.userId },
      data: shouldSchedule
        ? {
            scheduledPlan: payment.plan,
            scheduledPlanAt: scheduledStartsAt,
            scheduledPlanExpiresAt: scheduledExpiresAt,
            isDemo: false,
          }
        : {
            plan: payment.plan,
            planPeriodStartedAt: confirmedAt,
            planExpiresAt: expiresAt,
            planSource: "PAYMENT",
            scheduledPlan: null,
            scheduledPlanAt: null,
            scheduledPlanExpiresAt: null,
            isDemo: false,
          },
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
            nextChargeAt: cancelled ? null : (scheduledExpiresAt ?? expiresAt),
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

/** Архивирует неоплаченные ссылки после того же срока, который задан банку. */
export async function expirePendingPayments(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const expired = await tx.payment.findMany({
      where: { status: "PENDING", expiresAt: { lte: now } },
      select: { id: true, subscriptionId: true },
    });
    if (!expired.length) return 0;
    await tx.payment.updateMany({
      where: { id: { in: expired.map((payment) => payment.id) }, status: "PENDING" },
      data: { status: "EXPIRED", expiredAt: now },
    });
    const subscriptionIds = expired.flatMap((payment) => payment.subscriptionId ? [payment.subscriptionId] : []);
    if (subscriptionIds.length) {
      await tx.billingSubscription.updateMany({
        where: { id: { in: subscriptionIds }, status: "PENDING" },
        data: { status: "CANCELLED", cancelledAt: now, nextChargeAt: null },
      });
    }
    return expired.length;
  });
}

/** Применяет любой заранее оплаченный переход, когда завершился текущий тариф. */
export async function applyDuePlanTransitions(now = new Date()) {
  await prisma.user.updateMany({
    where: {
      scheduledPlan: { not: null },
      scheduledPlanExpiresAt: { lte: now },
    },
    data: {
      scheduledPlan: null,
      scheduledPlanAt: null,
      scheduledPlanExpiresAt: null,
    },
  });
  const due = await prisma.user.findMany({
    where: {
      scheduledPlan: { not: null },
      scheduledPlanAt: { lte: now },
      scheduledPlanExpiresAt: { gt: now },
    },
    select: {
      id: true,
      scheduledPlan: true,
      scheduledPlanAt: true,
      scheduledPlanExpiresAt: true,
    },
  });
  if (!due.length) return 0;
  await prisma.$transaction(
    due.map((user) => prisma.user.update({
      where: { id: user.id },
      data: {
        plan: user.scheduledPlan!,
        planPeriodStartedAt: user.scheduledPlanAt!,
        planExpiresAt: user.scheduledPlanExpiresAt!,
        planSource: "PAYMENT",
        scheduledPlan: null,
        scheduledPlanAt: null,
        scheduledPlanExpiresAt: null,
      },
    })),
  );
  return due.length;
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
      data: {
        plan,
        planPeriodStartedAt: plan === "TRIAL" ? null : now,
        planExpiresAt: expiresAt,
        planSource: plan === "TRIAL" ? "TRIAL" : "ADMIN",
        scheduledPlan: null,
        scheduledPlanAt: null,
        scheduledPlanExpiresAt: null,
        isDemo: false,
      },
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

/**
 * Одноразово исправляет сохранённый срок по фактической истории платежей.
 * Вызывается администратором только после явного расхождения в истории.
 */
export async function repairPaidPlanExpiry(userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        plan: true,
        scheduledPlan: true,
        payments: {
          where: { status: "CONFIRMED" },
          orderBy: { confirmedAt: "asc" },
          select: {
            status: true,
            confirmedAt: true,
            plan: true,
            changeType: true,
            activationMode: true,
            entitlementEndsAt: true,
          },
        },
      },
    });
    if (!user || user.payments.length === 0 || user.scheduledPlan) return null;

    const latestPayment = user.payments[user.payments.length - 1];
    const expiresAt = expectedPaidPlanExpiry(user.payments);
    if (!expiresAt || latestPayment.plan !== user.plan) return null;

    const updated = await tx.user.update({
      where: { id: user.id },
      data: { planExpiresAt: expiresAt },
    });
    await tx.billingSubscription.updateMany({
      where: {
        userId: user.id,
        status: { in: ["ACTIVE", "CHARGING", "PAST_DUE"] },
      },
      data: { nextChargeAt: expiresAt },
    });
    await cancelPendingPlanNotifications(user.id, new Date(), tx);
    return updated;
  });
}

/** Продлевает именно демо тарифа «Стандартный» от текущего срока или от сегодня. */
