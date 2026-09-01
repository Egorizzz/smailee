import { prisma } from "@/lib/prisma";
import { limitsFor, isPlanActive, UPLOAD_CONTACT_LIMITS } from "@/lib/plans";
import type { User } from "@prisma/client";
import {
  SEARCH_CREDIT_LIMITS,
  prospectingCriteriaFingerprint,
  prospectingSearchMode,
  searchCreditsForCompanies,
  type ProspectingSearchMode,
} from "@/lib/company-data/searchBudget";

export type LimitCheck = { ok: true } | { ok: false; error: string };

const PLAN_PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;

/** Пробные квоты считаются за всё время, платные — от начала активного периода. */
export async function quotaDateFilter(
  user: Pick<User, "id" | "plan" | "planPeriodStartedAt" | "planExpiresAt">,
  now = new Date(),
) {
  if (user.plan === "TRIAL") return {};
  const fallback = user.planExpiresAt
    ? new Date(user.planExpiresAt.getTime() - PLAN_PERIOD_MS)
    : now;
  return { gte: user.planPeriodStartedAt ?? fallback };
}

export async function sentQuotaDateFilter(
  user: Pick<User, "id" | "plan" | "planPeriodStartedAt" | "planExpiresAt">,
  now = new Date(),
) {
  return user.plan === "TRIAL" ? { not: null } : quotaDateFilter(user, now);
}

export async function getEmailQuotaUsage(user: User, now = new Date()) {
  const limit = limitsFor(user.plan, user.planExpiresAt).maxEmailsPerMonth;
  const used = await prisma.message.count({
    where: {
      campaign: { userId: user.id, isDemo: false },
      sentAt: await sentQuotaDateFilter(user, now),
    },
  });
  return { used, limit, remaining: Math.max(0, limit - used) };
}

function upgradeHint(user: User): string {
  if (user.plan === "TRIAL") return " Выберите тариф в разделе «Тариф и оплата».";
  return !isPlanActive(user.plan, user.planExpiresAt)
    ? " Оплатите тариф в разделе «Тариф и оплата»."
    : " Перейдите на тариф выше в разделе «Тариф и оплата».";
}

export async function checkUploadedContactLimit(user: User, adding: number): Promise<LimitCheck> {
  if (!isPlanActive(user.plan, user.planExpiresAt)) {
    return { ok: false, error: "Доступ приостановлен. Оплатите тариф, чтобы добавлять контакты." };
  }
  const { used } = await getUploadedContactUsage(user);
  if (used + adding > UPLOAD_CONTACT_LIMITS[user.plan]) {
    return user.plan === "TRIAL"
      ? { ok: false, error: "На пробном тарифе больше загрузить нельзя. Чтобы загрузить больше контактов, перейдите на платный тариф." }
      : { ok: false, error: "На текущем тарифе больше загрузить нельзя. Чтобы продолжить, перейдите на тариф выше." };
  }
  return { ok: true };
}

export async function getContactProcessingUsage(user: User, now = new Date()) {
  const limit = limitsFor(user.plan, user.planExpiresAt).maxContacts;
  return getContactUsageBySource(user, limit, "search", now);
}

export async function getUploadedContactUsage(user: User, now = new Date()) {
  return getContactUsageBySource(user, UPLOAD_CONTACT_LIMITS[user.plan], "upload", now);
}

/** @deprecated Use checkUploadedContactLimit. Kept for existing import integrations. */
export const checkContactLimit = checkUploadedContactLimit;

async function getContactUsageBySource(user: User, limit: number, bucket: "search" | "upload", now: Date) {
  const organizationId = user.organizationId ?? `user:${user.id}`;
  const createdAt = await quotaDateFilter(user, now);
  const events = await prisma.contactQuotaEvent.findMany({
    where: {
      organizationId,
      createdAt,
      source: bucket === "search" ? "AI_SEARCH" : { not: "AI_SEARCH" },
    },
    select: { email: true },
  });
  const legacyContacts = await prisma.contact.count({ where: {
    userId: user.id,
    isDemo: false,
    isControl: false,
    createdAt,
    source: bucket === "search" ? "AI_SEARCH" : { not: "AI_SEARCH" },
    ...(events.length ? { email: { notIn: events.map((event) => event.email) } } : {}),
  } });
  const used = events.length + legacyContacts;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

export async function getCompanyInspectionUsage(user: User, now = new Date()) {
  const limit = isPlanActive(user.plan, user.planExpiresAt) ? SEARCH_CREDIT_LIMITS[user.plan] : 0;
  const createdAt = await quotaDateFilter(user, now);
  const runs = user.organizationId ? await prisma.prospectingRun.findMany({
    where: { organizationId: user.organizationId, createdAt },
    select: { processedCount: true, acceptedCount: true, query: true },
  }) : [];
  const byMode = (mode: ProspectingSearchMode) => runs.filter((run) => prospectingSearchMode(run.query) === mode);
  const standardRuns = byMode("standard");
  const deepRuns = byMode("deep");
  const standardUsed = standardRuns.reduce((sum, run) => sum + searchCreditsForCompanies("standard", run.processedCount), 0);
  const deepUsed = deepRuns.reduce((sum, run) => sum + searchCreditsForCompanies("deep", run.processedCount), 0);
  const used = standardUsed + deepUsed;
  const history = Object.fromEntries((["standard", "deep"] as const).map((mode) => {
    const matching = byMode(mode);
    return [mode, {
      processed: matching.reduce((sum, run) => sum + run.processedCount, 0),
      accepted: matching.reduce((sum, run) => sum + run.acceptedCount, 0),
    }];
  })) as Record<ProspectingSearchMode, { processed: number; accepted: number }>;
  const historyByCriteria = runs.reduce<Record<string, { processed: number; accepted: number }>>((result, run) => {
    const key = prospectingCriteriaFingerprint(run.query);
    const current = result[key] ?? { processed: 0, accepted: 0 };
    result[key] = { processed: current.processed + run.processedCount, accepted: current.accepted + run.acceptedCount };
    return result;
  }, {});
  return { used, limit, remaining: Math.max(0, limit - used), standardUsed, deepUsed, history, historyByCriteria };
}

export async function checkEmailQuota(user: User, adding: number): Promise<LimitCheck> {
  if (!isPlanActive(user.plan, user.planExpiresAt)) {
    return { ok: false, error: "Доступ приостановлен. Оплатите тариф, чтобы запускать кампании." };
  }
  const limits = limitsFor(user.plan, user.planExpiresAt);
  const createdAt = await quotaDateFilter(user);
  const used = await prisma.message.count({
    where: { campaign: { userId: user.id, isDemo: false }, createdAt },
  });
  if (used + adding > limits.maxEmailsPerMonth) {
    const period = user.plan === "TRIAL" ? "на пробном тарифе" : "в месяц";
    return { ok: false, error: `Лимит писем ${period} — ${limits.maxEmailsPerMonth} (использовано ${used}, требуется ещё ${adding}).${upgradeHint(user)}` };
  }
  return { ok: true };
}
