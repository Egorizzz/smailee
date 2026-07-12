import type { Plan } from "@prisma/client";

/**
 * Тарифные планы Smailee и их лимиты.
 * Гейтинг применяется при загрузке контактов и создании кампании.
 * NB: лимит числа ящиков в модели C намеренно не гейтим планом — пул ящиков
 * приносит клиент (десятки на объём), а ценообразование пересчитывается
 * отдельно (ТЗ §9.3), это влияет на продукт, не на код.
 */

export type PlanLimits = {
  name: string;
  priceRub: number; // ₽/мес (0 = бесплатно)
  maxContacts: number;
  maxEmailsPerMonth: number;
};

// TRIAL = тариф «Демо»: бесплатный вход с минимальными лимитами.
export const PLANS: Record<Plan, PlanLimits> = {
  TRIAL: {
    name: "Демо",
    priceRub: 0,
    maxContacts: 100,
    maxEmailsPerMonth: 200,
  },
  START: {
    name: "Старт",
    priceRub: 7999,
    maxContacts: 2000,
    maxEmailsPerMonth: 5000,
  },
  PRO: {
    name: "Про",
    priceRub: 19999,
    maxContacts: 10000,
    maxEmailsPerMonth: 30000,
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
