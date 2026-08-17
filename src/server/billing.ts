/**
 * Billing: подтверждение платежей и активация тарифов.
 * Вебхук платёжного шлюза только парсит запрос и вызывает confirmPayment().
 * Смена шлюза (ЮMoney → другой) не трогает эту логику.
 */
import { prisma } from "@/lib/prisma";
import type { Plan } from "@prisma/client";
import { PLANS } from "@/lib/plans";
import { PUBLIC_OFFER_VERSION } from "@/lib/legal";
import { cancelPendingPlanNotifications, scheduleManualPlanDisabled } from "@/server/planNotifications";

const PLAN_DURATION_DAYS = 30;
export const DEMO_DURATION_DAYS = 14;

/** Создаёт ожидающий платёж (перед редиректом на оплату). */
export async function createPendingPayment(input: {
  userId: string;
  plan: Plan;
  provider: string;
  externalId?: string;
}) {
  return prisma.payment.create({
    data: {
      userId: input.userId,
      plan: input.plan,
      provider: input.provider,
      externalId: input.externalId,
      amount: PLANS[input.plan].priceRub * 100, // копейки
      status: "PENDING",
      offerVersion: PUBLIC_OFFER_VERSION,
    },
  });
}

/**
 * Подтверждение платежа (из вебхука шлюза или вручную админом).
 * Идемпотентно: повторное подтверждение не продлевает план дважды.
 * Активация: план на 30 дней от максимума(сейчас, текущий срок) —
 * то есть продление складывается, а не перезаписывается.
 */
export async function confirmPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { user: true },
  });
  if (!payment) throw new Error("payment not found");
  if (payment.status === "CONFIRMED") return payment; // идемпотентность

  const base =
    payment.user.planExpiresAt && payment.user.planExpiresAt > new Date()
      ? payment.user.planExpiresAt
      : new Date();
  const expiresAt = new Date(base);
  expiresAt.setDate(expiresAt.getDate() + PLAN_DURATION_DAYS);

  const [updated] = await prisma.$transaction([
    prisma.payment.update({
      where: { id: paymentId },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: payment.userId },
      data: { plan: payment.plan, planExpiresAt: expiresAt, isDemo: false },
    }),
  ]);
  await cancelPendingPlanNotifications(payment.userId);
  return updated;
}

/** Поиск платежа по внешнему id шлюза (для вебхука). */
export async function findPaymentByExternalId(externalId: string) {
  return prisma.payment.findFirst({ where: { externalId } });
}

/**
 * Одноразовый self-service демо-доступ: лимиты START на 14 дней.
 * Не создаёт платёж и не продлевает уже действующий либо оплаченный тариф.
 */
export async function activateDemoAccess(userId: string): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + DEMO_DURATION_DAYS);

  const activated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
        planExpiresAt: true,
        demoUsedAt: true,
        payments: { where: { status: "CONFIRMED" }, select: { id: true }, take: 1 },
      },
    });
    if (!user || user.demoUsedAt || user.plan !== "TRIAL" || user.payments.length > 0) return false;

    // updateMany сохраняет одноразовость при двойном клике или двух вкладках.
    const updated = await tx.user.updateMany({
      where: { id: userId, plan: "TRIAL", demoUsedAt: null },
      data: { plan: "START", planExpiresAt: expiresAt, demoUsedAt: now, isDemo: true },
    });
    return updated.count === 1;
  });
  if (activated) await cancelPendingPlanNotifications(userId, now);
  return activated;
}

/** Ручная смена плана админом (без платежа). */
export async function adminSetPlan(userId: string, plan: Plan, days = 30) {
  const now = new Date();
  const expiresAt =
    plan === "TRIAL" ? null : new Date(now.getTime() + days * 24 * 3600 * 1000);
  return prisma.$transaction(async (tx) => {
    const previous = await tx.user.findUnique({
      where: { id: userId },
      select: { plan: true, planExpiresAt: true, isDemo: true },
    });
    const wasActive = Boolean(
      previous && previous.plan !== "TRIAL" && previous.planExpiresAt && previous.planExpiresAt > now,
    );
    const disabledAlreadySent = previous && !wasActive
      ? await tx.planNotification.findFirst({
          where: {
            userId,
            kind: "PLAN_DISABLED",
            planEndsAt: previous.planExpiresAt ?? undefined,
            sentAt: { not: null },
          },
          select: { id: true },
        })
      : null;
    const updated = await tx.user.update({
      where: { id: userId },
      data: { plan, planExpiresAt: expiresAt, isDemo: false },
    });
    const preserveExpiredCycle = plan === "TRIAL" && previous?.planExpiresAt && disabledAlreadySent;
    if (preserveExpiredCycle) {
      await tx.planNotification.updateMany({
        where: {
          userId,
          planEndsAt: previous.planExpiresAt!,
          sentAt: null,
          canceledAt: null,
        },
        data: { requiresExpiryMatch: false },
      });
      await tx.planNotification.updateMany({
        where: {
          userId,
          planEndsAt: { not: previous.planExpiresAt! },
          sentAt: null,
          canceledAt: null,
        },
        data: { canceledAt: now },
      });
    } else {
      await cancelPendingPlanNotifications(userId, now, tx);
    }
    if (plan === "TRIAL" && previous && previous.plan !== "TRIAL" && !disabledAlreadySent) {
      await scheduleManualPlanDisabled({
        userId,
        previousPlan: previous.plan,
        wasDemo: previous.isDemo,
        now,
      }, tx);
    }
    return updated;
  });
}

/** Продлевает именно демо тарифа «Стандартный» от текущего срока или от сегодня. */
export async function adminExtendDemo(userId: string, days = DEMO_DURATION_DAYS) {
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "CLIENT" || !user.isDemo) return null;
    const base = user.planExpiresAt && user.planExpiresAt > now ? user.planExpiresAt : now;
    const expiresAt = new Date(base);
    expiresAt.setDate(expiresAt.getDate() + days);
    return tx.user.update({
      where: { id: userId },
      data: { plan: "START", planExpiresAt: expiresAt, isDemo: true },
    });
  });
  if (updated) await cancelPendingPlanNotifications(userId, now);
  return updated;
}
