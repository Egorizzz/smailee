/**
 * Гейтинг тарифных лимитов — централизованно.
 * Вызывается из server actions перед операциями, расходующими квоты.
 * Возвращает { ok } либо { ok:false, error } с человекочитаемым сообщением.
 */
import { prisma } from "@/lib/prisma";
import { limitsFor, isPlanActive } from "@/lib/plans";
import type { User } from "@prisma/client";

export type LimitCheck = { ok: true } | { ok: false; error: string };

export function emailQuotaMonthStart(now = new Date()): Date {
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  return monthStart;
}

/** Фактически отправленные письма за текущий календарный месяц. */
export async function getEmailQuotaUsage(user: User, now = new Date()) {
  const limit = limitsFor(user.plan, user.planExpiresAt).maxEmailsPerMonth;
  const used = await prisma.message.count({
    where: {
      campaign: { userId: user.id },
      sentAt: { gte: emailQuotaMonthStart(now) },
    },
  });
  return { used, limit, remaining: Math.max(0, limit - used) };
}

function upgradeHint(user: User): string {
  return !isPlanActive(user.plan, user.planExpiresAt)
    ? " Срок доступа завершён. Оплатите тариф в разделе «Тариф и оплата»."
    : " Перейдите на тариф выше в разделе «Тариф и оплата».";
}

/** Можно ли добавить ещё N контактов */
export async function checkContactLimit(
  user: User,
  adding: number
): Promise<LimitCheck> {
  if (!isPlanActive(user.plan, user.planExpiresAt)) {
    return { ok: false, error: "Срок доступа завершён. Добавление контактов недоступно до оплаты тарифа." };
  }
  const limits = limitsFor(user.plan, user.planExpiresAt);
  const current = await prisma.contact.count({ where: { userId: user.id } });
  if (current + adding > limits.maxContacts) {
    return {
      ok: false,
      error: `Лимит контактов на вашем тарифе — ${limits.maxContacts} (сейчас ${current}, добавляется ${adding}).${upgradeHint(user)}`,
    };
  }
  return { ok: true };
}

/** Хватает ли месячной квоты писем на отправку ещё N штук */
export async function checkEmailQuota(
  user: User,
  adding: number
): Promise<LimitCheck> {
  if (!isPlanActive(user.plan, user.planExpiresAt)) {
    return { ok: false, error: "Срок доступа завершён. Запуск и отправка кампаний недоступны до оплаты тарифа." };
  }
  const limits = limitsFor(user.plan, user.planExpiresAt);
  const monthStart = emailQuotaMonthStart();
  const sentThisMonth = await prisma.message.count({
    where: {
      campaign: { userId: user.id },
      createdAt: { gte: monthStart },
    },
  });
  if (sentThisMonth + adding > limits.maxEmailsPerMonth) {
    return {
      ok: false,
      error: `Лимит писем в месяц — ${limits.maxEmailsPerMonth} (использовано ${sentThisMonth}, требуется ещё ${adding}).${upgradeHint(user)}`,
    };
  }
  return { ok: true };
}
