/**
 * Billing: подтверждение платежей и активация тарифов.
 * Вебхук платёжного шлюза только парсит запрос и вызывает confirmPayment().
 * Смена шлюза (ЮMoney → другой) не трогает эту логику.
 */
import { prisma } from "@/lib/prisma";
import type { Plan } from "@prisma/client";
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
 * Первый подтверждённый платёж открывает 45 дней доступа: дополнительные
 * 15 дней покрывают прогрев новых ящиков. Каждый следующий платёж открывает
 * новый 30-дневный расчётный период.
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

    const confirmedPayments = await tx.payment.count({
      where: { userId: payment.userId, status: "CONFIRMED" },
    });
    const durationDays = confirmedPayments === 0 ? FIRST_PAYMENT_DURATION_DAYS : PLAN_DURATION_DAYS;
    const confirmedAt = new Date();
    const expiresAt = new Date(confirmedAt);
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: { status: "CONFIRMED", confirmedAt },
    });
    await tx.user.update({
      where: { id: payment.userId },
      data: { plan: payment.plan, planExpiresAt: expiresAt, isDemo: false },
    });
    return { payment: updated, newlyConfirmed: true };
  });

  if (result.newlyConfirmed) await cancelPendingPlanNotifications(initialPayment.userId);
  return result.payment;
}

/** Поиск платежа по внешнему id шлюза (для вебхука). */
export async function findPaymentByExternalId(externalId: string) {
  return prisma.payment.findFirst({ where: { externalId } });
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
  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { plan, planExpiresAt: expiresAt, isDemo: false },
    });
    await cancelPendingPlanNotifications(userId, now, tx);
    return updated;
  });
}

/** Продлевает именно демо тарифа «Стандартный» от текущего срока или от сегодня. */
