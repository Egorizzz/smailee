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
 * Каждый подтверждённый платёж открывает новый 30-дневный расчётный период.
 * От этого же момента заново считаются тарифные квоты.
 */
export async function confirmPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { user: true },
  });
  if (!payment) throw new Error("payment not found");
  if (payment.status === "CONFIRMED") return payment; // идемпотентность

  const confirmedAt = new Date();
  const expiresAt = new Date(confirmedAt);
  expiresAt.setDate(expiresAt.getDate() + PLAN_DURATION_DAYS);

  const [updated] = await prisma.$transaction([
    prisma.payment.update({
      where: { id: paymentId },
      data: { status: "CONFIRMED", confirmedAt },
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
