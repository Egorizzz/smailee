/**
 * Гейтинг тарифных лимитов — централизованно.
 * Вызывается из server actions перед операциями, расходующими квоты.
 * Возвращает { ok } либо { ok:false, error } с человекочитаемым сообщением.
 */
import { prisma } from "@/lib/prisma";
import { limitsFor, effectivePlan, PLANS } from "@/lib/plans";
import type { User } from "@prisma/client";

export type LimitCheck = { ok: true } | { ok: false; error: string };

function upgradeHint(user: User): string {
  const eff = effectivePlan(user.plan, user.planExpiresAt);
  return eff === "TRIAL"
    ? ` Оплатите тариф «${PLANS.START.name}» в разделе «Тариф», чтобы расширить лимиты.`
    : " Перейдите на тариф выше в разделе «Тариф».";
}

/** Можно ли добавить ещё N контактов */
export async function checkContactLimit(
  user: User,
  adding: number
): Promise<LimitCheck> {
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
  const limits = limitsFor(user.plan, user.planExpiresAt);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
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

/** Можно ли добавить ещё одного отправителя */
export async function checkSenderLimit(user: User): Promise<LimitCheck> {
  const limits = limitsFor(user.plan, user.planExpiresAt);
  const current = await prisma.sender.count({ where: { userId: user.id } });
  if (current + 1 > limits.maxSenders) {
    return {
      ok: false,
      error: `Лимит отправителей на вашем тарифе — ${limits.maxSenders}.${upgradeHint(user)}`,
    };
  }
  return { ok: true };
}
