import type { Plan } from "@prisma/client";

export type PlanLimits = {
  name: string;
  priceRub: number;
  maxContacts: number;
  maxEmailsPerMonth: number;
  mailboxQuota: number;
};

export const PLANS: Record<Plan, PlanLimits> = {
  TRIAL: {
    name: "Пробный",
    priceRub: 0,
    maxContacts: 5,
    maxEmailsPerMonth: 50,
    mailboxQuota: 1,
  },
  BASIC: { name: "Базовый", priceRub: 3990, maxContacts: 500, maxEmailsPerMonth: 1250, mailboxQuota: 3 },
  START: { name: "Стандартный", priceRub: 7999, maxContacts: 2000, maxEmailsPerMonth: 5000, mailboxQuota: 10 },
  PRO: { name: "Про", priceRub: 19999, maxContacts: 5000, maxEmailsPerMonth: 30000, mailboxQuota: 50 },
};

const SUSPENDED_LIMITS: PlanLimits = {
  name: "Доступ приостановлен",
  priceRub: 0,
  maxContacts: 0,
  maxEmailsPerMonth: 0,
  mailboxQuota: 0,
};

export const PAID_PLAN_KEYS = ["BASIC", "START", "PRO"] as const satisfies readonly Plan[];
export const TRIAL_UPLOAD_CONTACT_LIMIT = 50;
export const UPLOAD_CONTACT_LIMITS: Record<Plan, number> = {
  TRIAL: TRIAL_UPLOAD_CONTACT_LIMIT,
  BASIC: PLANS.BASIC.maxContacts,
  START: PLANS.START.maxContacts,
  PRO: PLANS.PRO.maxContacts,
};

/** Пробный тариф бессрочный; платные работают до planExpiresAt. */
export function isPlanActive(plan: Plan, planExpiresAt: Date | null, now = new Date()): boolean {
  if (plan === "TRIAL") return true;
  return Boolean(planExpiresAt && planExpiresAt > now);
}

export function effectivePlan(plan: Plan, planExpiresAt: Date | null, now = new Date()): Plan {
  return isPlanActive(plan, planExpiresAt, now) ? plan : "TRIAL";
}

export function limitsFor(plan: Plan, planExpiresAt: Date | null): PlanLimits {
  return isPlanActive(plan, planExpiresAt) ? PLANS[plan] : SUSPENDED_LIMITS;
}

export function planDisplayName(input: { plan: Plan; planExpiresAt: Date | null; isDemo?: boolean }, now = new Date()) {
  return isPlanActive(input.plan, input.planExpiresAt, now)
    ? PLANS[input.plan].name
    : SUSPENDED_LIMITS.name;
}
