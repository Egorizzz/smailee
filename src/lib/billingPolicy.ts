import type { Plan } from "@prisma/client";
export const PAYMENT_LINK_TTL_MINUTES = 7 * 24 * 60;
export const PAYMENT_LINK_TTL_MS = PAYMENT_LINK_TTL_MINUTES * 60_000;

const PLAN_RANK: Record<Plan, number> = {
  TRIAL: 0,
  BASIC: 1,
  START: 2,
  PRO: 3,
};

export function comparePlans(left: Plan, right: Plan) {
  return PLAN_RANK[left] - PLAN_RANK[right];
}

export function paymentLinkExpiresAt(now = new Date()) {
  return new Date(now.getTime() + PAYMENT_LINK_TTL_MS);
}
