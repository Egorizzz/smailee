import type { Plan } from "@prisma/client";

/**
 * Тарифные планы Smailee и их лимиты.
 * Гейтинг применяется при: загрузке контактов, создании кампании,
 * добавлении отправителя.
 */

export type PlanLimits = {
  name: string;
  priceRub: number; // ₽/мес (0 = бесплатно)
  maxContacts: number;
  maxEmailsPerMonth: number;
  maxSenders: number;
};

export const PLANS: Record<Plan, PlanLimits> = {
  TRIAL: {
    name: "Пробный",
    priceRub: 0,
    maxContacts: 100,
    maxEmailsPerMonth: 200,
    maxSenders: 1,
  },
  START: {
    name: "Старт",
    priceRub: 7999,
    maxContacts: 2000,
    maxEmailsPerMonth: 5000,
    maxSenders: 2,
  },
  PRO: {
    name: "Про",
    priceRub: 19999,
    maxContacts: 10000,
    maxEmailsPerMonth: 30000,
    maxSenders: 5,
  },
};

/** Активен ли платный план (не истёк). TRIAL всегда «активен» в своих лимитах. */
export function isPlanActive(plan: Plan, planExpiresAt: Date | null): boolean {
  if (plan === "TRIAL") return true;
  if (!planExpiresAt) return false;
  return planExpiresAt > new Date();
}

/**
 * Эффективный план: если платный истёк — откатываемся на TRIAL-лимиты.
 * Это и есть «автопереключение» тарифа без участия админа.
 */
export function effectivePlan(plan: Plan, planExpiresAt: Date | null): Plan {
  return isPlanActive(plan, planExpiresAt) ? plan : "TRIAL";
}

export function limitsFor(plan: Plan, planExpiresAt: Date | null): PlanLimits {
  return PLANS[effectivePlan(plan, planExpiresAt)];
}
