import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { prisma } from "@/lib/prisma";
import { createProspectingRun, prospectingBudgetsSchema } from "@/lib/company-data";
import { getCompanyInspectionUsage, getContactProcessingUsage } from "@/server/limits";
import { ERROR_CODES, ProductError, productErrorResponse } from "@/lib/productErrors";
import {
  assessDeepSearchRisk,
  availableSearchCredits,
  estimateProspectingBudget,
  prospectingCriteriaFingerprint,
  safeDeepSearchCredits,
  SEARCH_CREDITS_PER_COMPANY,
} from "@/lib/company-data/searchBudget";

const createSchema = z.object({
  query: z.record(z.string(), z.unknown()),
  targetCompanies: z.number().int().min(1).max(1_000).optional(),
  targetContacts: z.number().int().min(1).max(5_000).optional(),
  maxCandidates: z.number().int().min(1).max(40_000).optional(),
  allowAcceptAll: z.boolean().default(true),
  minAcceptAllScore: z.number().int().min(0).max(100).default(0),
  budgets: prospectingBudgetsSchema.partial().optional(),
  searchMode: z.enum(["standard", "deep"]).default("standard"),
  deepLimitConsent: z.boolean().default(false),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.organizationId) return Response.json({ error: "Требуется организация" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_VIEW")) {
    return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const runs = await prisma.prospectingRun.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "desc" }, take: 50,
    select: {
      id: true, status: true, targetCompanies: true, targetContacts: true, maxCandidates: true, budgets: true, usage: true,
      selectedCount: true, processedCount: true, acceptedCount: true, rejectedCount: true,
      error: true, createdAt: true, startedAt: true, completedAt: true,
    },
  });
  return Response.json({ runs });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.organizationId) return Response.json({ error: "Требуется организация" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_MANAGE")) {
    return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  try {
    const body = createSchema.parse(await request.json());
    const requestedKeywords = stringArray(body.query.keywords);
    const requestedExclusions = stringArray(body.query.exclude_company_traits);
    if (body.searchMode === "deep" && !requestedKeywords.length && !requestedExclusions.length) {
      throw new ProductError(ERROR_CODES.prospecting, "Для глубокого поиска добавьте хотя бы один критерий проверки по сайту.", 400);
    }
    const safeQuery = body.searchMode === "deep"
      ? body.query
      : withoutDeepSearchFields(body.query);
    const owner = (await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId }, include: { owner: true } })).owner;
    const [quota, inspection] = await Promise.all([getContactProcessingUsage(owner), getCompanyInspectionUsage(owner)]);
    if (quota.remaining <= 0) throw new ProductError(ERROR_CODES.quotaExceeded, "Месячный лимит контактов уже использован.", 409);
    const availableCredits = availableSearchCredits({
      mode: body.searchMode,
      limit: inspection.limit,
      used: inspection.used,
      deepUsed: inspection.deepUsed,
    });
    if (availableCredits <= 0) throw new ProductError(ERROR_CODES.sourceExhausted, "Лимит поиска на этот период закончился. Измените критерии или дождитесь обновления лимита.", 409);
    const targetContacts = Math.min(body.targetContacts ?? quota.remaining, quota.remaining);
    const criteriaHistory = body.searchMode === "deep"
      ? inspection.historyByCriteria[prospectingCriteriaFingerprint({ ...safeQuery, search_mode: body.searchMode })]
      : inspection.history.standard;
    let estimate = estimateProspectingBudget({
      mode: body.searchMode,
      targetContacts,
      availableCredits,
      history: criteriaHistory,
      standardHistory: inspection.history.standard,
    });
    if (estimate.maxCompanies < 1) throw new ProductError(ERROR_CODES.sourceExhausted, "Лимита поиска недостаточно даже для одной компании. Дождитесь обновления лимита.", 409);
    const deepRisk = body.searchMode === "deep" ? assessDeepSearchRisk({
      limit: inspection.limit,
      used: inspection.used,
      remainingCredits: inspection.remaining,
      deepUsed: inspection.deepUsed,
      remainingContacts: quota.remaining,
      estimate,
      deepHistory: criteriaHistory,
      standardHistory: inspection.history.standard,
    }) : null;
    let safeDeepStage = false;
    if (deepRisk?.requiresConsent && !body.deepLimitConsent) {
      const safeAllowance = safeDeepSearchCredits({
        limit: inspection.limit,
        remainingCredits: inspection.remaining,
        deepUsed: inspection.deepUsed,
        remainingContacts: quota.remaining,
        standardHistory: inspection.history.standard,
      });
      if (safeAllowance < SEARCH_CREDITS_PER_COMPANY.deep) {
        return Response.json({
          requiresDeepLimitConsent: true,
          estimate,
          quota,
          searchLimit: deepRisk,
        });
      }
      estimate = estimateProspectingBudget({
        mode: "deep",
        targetContacts,
        availableCredits,
        modeCreditCap: safeAllowance,
        history: criteriaHistory,
        standardHistory: inspection.history.standard,
      });
      safeDeepStage = true;
    }
    const maxCandidates = estimate.maxCompanies;
    const { deepLimitConsent: _deepLimitConsent, ...createInput } = body;
    const run = await createProspectingRun(prisma, {
      organizationId: user.organizationId, createdById: user.id, ...createInput,
      query: {
        ...safeQuery,
        search_mode: body.searchMode,
        ...(safeDeepStage ? { deep_safe_stage: true } : {}),
        ...(body.searchMode === "deep" && body.deepLimitConsent ? { deep_limit_consent: true } : {}),
      },
      targetContacts, targetCompanies: maxCandidates, maxCandidates,
    });
    return Response.json({ run, requiresConfirmation: true, quota, estimate, safeDeepStage }, { status: 201 });
  } catch (error) {
    return productErrorResponse(error, ERROR_CODES.prospecting);
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function withoutDeepSearchFields(query: Record<string, unknown>) {
  const safe = { ...query };
  delete safe.keywords;
  delete safe.exclude_company_traits;
  delete safe.only_with_websites;
  delete safe.income_from;
  delete safe.income_to;
  delete safe.workers_count_from;
  delete safe.workers_count_to;
  delete safe.registration_date_from;
  return safe;
}
