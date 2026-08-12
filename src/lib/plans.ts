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
  priceRub: number; // ₽/мес
  maxContacts: number;
  maxEmailsPerMonth: number;
};

// TRIAL — техническое состояние замороженного кабинета. Оно не показывается
// как тариф и не даёт права на отправку или добавление контактов.
export const PLANS: Record<Plan, PlanLimits> = {
  TRIAL: {
    name: "Доступ приостановлен",
    priceRub: 0,
    maxContacts: 0,
    maxEmailsPerMonth: 0,
  },
  BASIC: {
    name: "Базовый",
    priceRub: 3990,
    maxContacts: 500,
    maxEmailsPerMonth: 1250,
  },
  START: {
    name: "Стандартный",
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

export const PAID_PLAN_KEYS = ["BASIC", "START", "PRO"] as const satisfies readonly Plan[];

/** Активен ли платный или демо-план. TRIAL не является рабочим тарифом. */
export function isPlanActive(plan: Plan, planExpiresAt: Date | null, now = new Date()): boolean {
  if (plan === "TRIAL") return false;
  if (!planExpiresAt) return false;
  return planExpiresAt > now;
}

/**
 * Эффективный план: если срок истёк — техническое состояние TRIAL с нулевыми
 * квотами. Данные остаются доступны для просмотра, отправка заморожена.
 */
export function effectivePlan(plan: Plan, planExpiresAt: Date | null, now = new Date()): Plan {
  return isPlanActive(plan, planExpiresAt, now) ? plan : "TRIAL";
}

export function limitsFor(plan: Plan, planExpiresAt: Date | null): PlanLimits {
  return PLANS[effectivePlan(plan, planExpiresAt)];
}

export function planDisplayName(input: { plan: Plan; planExpiresAt: Date | null; isDemo: boolean }, now = new Date()) {
  const active = isPlanActive(input.plan, input.planExpiresAt, now);
  if (input.isDemo) return active ? "Демо · Стандартный" : "Демо «Стандартный» завершено";
  return active ? PLANS[input.plan].name : "Доступ приостановлен";
}
