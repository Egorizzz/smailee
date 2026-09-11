import { Prisma, type PrismaClient, type ProspectingRun } from "@prisma/client";
import { z } from "zod";
import { checkoFromEnv, dataNewtonFromEnv, hunterFromEnv, reoonFromEnv } from "./providers/env";
import { runProspectingPipeline, type ProspectingPipelineResult } from "./prospectingPipeline";
import type { DataNewtonQuery } from "./providers/datanewton";
import type { analyzeCompanySite } from "./siteIntelligence";
import { quotaKey } from "@/lib/contacts/processing";
import { CONTACT_QUOTA_SOURCE } from "@/lib/contacts/quotaSources";
import { publicCompanyFacts, publicCompanyName, publicSegment } from "./contactPresentation";
import { isPlanActive } from "@/lib/plans";
import { logProspecting, prospectingErrorDetails, prospectingErrorMessage } from "./prospectingLog";

export const prospectingBudgetsSchema = z.object({
  maxDataNewtonRecords: z.number().int().min(1).max(40_000),
  maxCheckoRequests: z.number().int().min(0).max(40_000),
  maxFirecrawlPages: z.number().int().min(0).max(120_000),
  maxHunterCredits: z.number().min(0).max(60_000),
  maxReoonCredits: z.number().min(0).max(60_000).default(2_000),
});

export type ProspectingBudgets = z.infer<typeof prospectingBudgetsSchema>;

export function defaultProspectingBudgets(targetContacts: number, maxCandidates: number): ProspectingBudgets {
  return {
    maxDataNewtonRecords: maxCandidates,
    // Checko is a conditional verifier. The budget is a failure-safe ceiling;
    // the normal run only spends it on incomplete or conflicting DataNewton cards.
    maxCheckoRequests: maxCandidates,
    maxFirecrawlPages: maxCandidates * 3,
    maxHunterCredits: targetContacts * 1.5,
    maxReoonCredits: targetContacts * 1.5,
  };
}

export async function createProspectingRun(prisma: PrismaClient, input: {
  organizationId: string;
  createdById: string;
  query: Record<string, unknown>;
  targetCompanies?: number;
  targetContacts?: number;
  maxCandidates?: number;
  allowAcceptAll?: boolean;
  minAcceptAllScore?: number;
  budgets?: Partial<ProspectingBudgets>;
}) {
  const targetContacts = Math.min(Math.max(input.targetContacts ?? input.targetCompanies ?? 500, 1), 10_000);
  const targetCompanies = Math.min(Math.max(input.targetCompanies ?? Math.ceil(targetContacts / 4), 1), 40_000);
  const maxCandidates = Math.min(Math.max(input.maxCandidates ?? targetCompanies, 1), 40_000);
  const budgets = prospectingBudgetsSchema.parse({
    ...defaultProspectingBudgets(targetContacts, maxCandidates),
    ...input.budgets,
  });
  if (budgets.maxDataNewtonRecords < maxCandidates) throw new Error("Бюджет DataNewton меньше количества компаний для обработки");
  const query = normalizeProspectingRunQuery(input.query);
  return prisma.prospectingRun.create({
    data: {
      organizationId: input.organizationId,
      createdById: input.createdById,
      query: query as Prisma.InputJsonValue,
      targetCompanies,
      targetContacts,
      maxCandidates: Math.min(maxCandidates, budgets.maxDataNewtonRecords),
      allowAcceptAll: input.allowAcceptAll ?? true,
      minAcceptAllScore: Math.min(Math.max(input.minAcceptAllScore ?? 0, 0), 100),
      budgets,
    },
  });
}

export function normalizeProspectingRunQuery(query: Record<string, unknown>) {
  const normalized = { ...query };
  const hasManualSiteCriteria = [normalized.keywords, normalized.exclude_company_traits].some((value) =>
    Array.isArray(value) && value.some((item) => typeof item === "string" && Boolean(item.trim())),
  );
  if (hasManualSiteCriteria) normalized.only_with_websites = true;
  return normalized;
}

export async function queueProspectingRun(prisma: PrismaClient, organizationId: string, runId: string) {
  const updated = await prisma.prospectingRun.updateMany({
    where: { id: runId, organizationId, status: { in: ["DRAFT", "PAUSED", "FAILED"] } },
    data: { status: "QUEUED", error: null, completedAt: null, cancelledAt: null },
  });
  if (!updated.count) throw new Error("Задание не найдено или его нельзя поставить в очередь");
  return prisma.prospectingRun.findUniqueOrThrow({ where: { id: runId } });
}

export async function cancelProspectingRun(prisma: PrismaClient, organizationId: string, runId: string) {
  const updated = await prisma.prospectingRun.updateMany({
    where: { id: runId, organizationId, status: { in: ["DRAFT", "QUEUED", "RUNNING", "PAUSED"] } },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (!updated.count) throw new Error("Задание не найдено или уже завершено");
}

export async function processQueuedProspectingRuns(prisma: PrismaClient, limit = 1) {
  const queued = await prisma.prospectingRun.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: Math.max(limit * 10, 50),
    include: { organization: { select: { owner: { select: { plan: true, planExpiresAt: true } } } } },
  });
  const results: Array<{ id: string; status: string }> = [];
  for (const run of queued) {
    if (results.length >= limit) break;
    if (!isPlanActive(run.organization.owner.plan, run.organization.owner.planExpiresAt)) continue;
    const claimed = await prisma.prospectingRun.updateMany({
      where: { id: run.id, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: run.startedAt ?? new Date(), error: null },
    });
    if (!claimed.count) continue;
    const startedAt = Date.now();
    const searchMode = stringFromQuery(run.query, "search_mode") === "deep" ? "deep" : "standard";
    logProspecting("info", "run_started", {
      runId: run.id,
      organizationId: run.organizationId,
      searchMode,
      targetContacts: run.targetContacts,
      maxCandidates: run.maxCandidates,
    });
    try {
      const result = await executeProspectingRun(prisma, run);
      logProspecting("info", "run_finished", {
        runId: run.id,
        organizationId: run.organizationId,
        status: result.complete ? "COMPLETED" : "COMPLETED_INCOMPLETE",
        durationMs: Date.now() - startedAt,
        selected: result.selected,
        processed: result.processed,
        accepted: result.accepted,
        rejected: result.rejected,
      });
      results.push({ id: run.id, status: result.complete ? "COMPLETED" : "COMPLETED_INCOMPLETE" });
    } catch (error) {
      const details = prospectingErrorDetails(error);
      const snapshot = await loadFailureSnapshot(prisma, run.id);
      logProspecting("error", "run_failed", {
        runId: run.id,
        organizationId: run.organizationId,
        durationMs: Date.now() - startedAt,
        processed: snapshot.processedCount,
        accepted: snapshot.acceptedCount,
        rejected: snapshot.rejectedCount,
        priorIssues: snapshot.issueCount,
        errorName: details.name,
        errorCode: details.code,
        errorStatus: details.status,
        errorMessage: details.message,
        errorCause: details.cause,
        errorStack: details.stack,
      });
      try {
        await prisma.prospectingRunIssue.create({
          data: {
            runId: run.id,
            stage: "pipeline",
            code: "SRC-2001",
            message: details.message.slice(0, 2_000),
            retryable: true,
            details: details as Prisma.InputJsonValue,
          },
        });
        await prisma.prospectingRun.update({
          where: { id: run.id },
          data: { status: "FAILED", error: "Не удалось продолжить сбор. Уже обработанные контакты сохранены. Код: SRC-2001" },
        });
      } catch (persistenceError) {
        const persistence = prospectingErrorDetails(persistenceError);
        logProspecting("error", "run_failure_persist_failed", {
          runId: run.id,
          organizationId: run.organizationId,
          errorName: persistence.name,
          errorCode: persistence.code,
          errorMessage: persistence.message,
        });
      }
      results.push({ id: run.id, status: "FAILED" });
    }
  }
  return results;
}

/**
 * Replays a small bounded window of persisted failures after a worker restart.
 * This makes failures created before structured logging was deployed visible in
 * Amvera without exposing the customer query or collected contacts.
 */
export async function logRecentProspectingFailures(prisma: PrismaClient, limit = 10) {
  try {
    const runs = await prisma.prospectingRun.findMany({
      where: {
        status: "FAILED",
        updatedAt: { gte: new Date(Date.now() - 2 * 86_400_000) },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.max(1, Math.min(limit, 25)),
      select: {
        id: true,
        organizationId: true,
        processedCount: true,
        acceptedCount: true,
        updatedAt: true,
        issues: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { stage: true, provider: true, code: true, message: true, retryable: true },
        },
      },
    });
    for (const run of runs) {
      const issue = run.issues[0];
      logProspecting("warn", "recent_run_failure", {
        runId: run.id,
        organizationId: run.organizationId,
        failedAt: run.updatedAt.toISOString(),
        processed: run.processedCount,
        accepted: run.acceptedCount,
        stage: issue?.stage,
        provider: issue?.provider,
        code: issue?.code ?? "SRC-2001",
        retryable: issue?.retryable,
        errorMessage: issue ? prospectingErrorMessage(issue.message) : undefined,
      });
    }
  } catch (error) {
    const details = prospectingErrorDetails(error);
    logProspecting("error", "recent_failures_load_failed", {
      errorName: details.name,
      errorCode: details.code,
      errorMessage: details.message,
    });
  }
}

export async function executeProspectingRun(
  prisma: PrismaClient,
  run: ProspectingRun,
  dependencies: {
    selector?: ReturnType<typeof dataNewtonFromEnv> | ReturnType<typeof checkoFromEnv>;
    verifier?: ReturnType<typeof checkoFromEnv>;
    hunter?: ReturnType<typeof hunterFromEnv>;
    reoon?: ReturnType<typeof reoonFromEnv>;
    siteAnalyzer?: typeof analyzeCompanySite;
  } = {},
): Promise<ProspectingPipelineResult> {
  const budgets = prospectingBudgetsSchema.parse(run.budgets);
  const storedQuery = isObject(run.query) ? run.query : {};
  const query = storedQuery as DataNewtonQuery;
  const runOrganization = await prisma.organization.findUniqueOrThrow({ where: { id: run.organizationId }, select: { ownerId: true } });
  const existingEmails = new Set((await prisma.contact.findMany({ where: { userId: runOrganization.ownerId }, select: { email: true } })).map((item) => item.email.toLowerCase()));
  const issueCounts = new Map<string, number>();
  let lastProgressLog = 0;
  const result = await runProspectingPipeline({
    prisma,
    selector: dependencies.selector ?? dataNewtonFromEnv(),
    verifier: dependencies.verifier ?? checkoFromEnv(),
    hunter: dependencies.hunter ?? hunterFromEnv(),
    reoon: dependencies.reoon ?? (process.env.LLM_TEST_MOCKS === "true" ? undefined : reoonFromEnv()),
    query: { ...query, limit: Math.min(run.maxCandidates, budgets.maxDataNewtonRecords) },
    target: run.targetContacts,
    maxCandidates: Math.min(run.maxCandidates, budgets.maxDataNewtonRecords),
    limits: {
      maxCheckoRequests: budgets.maxCheckoRequests,
      maxFirecrawlPages: budgets.maxFirecrawlPages,
      maxHunterCredits: budgets.maxHunterCredits,
      maxReoonCredits: budgets.maxReoonCredits,
    },
    verificationPolicy: { allowAcceptAll: run.allowAcceptAll, minAcceptAllScore: run.minAcceptAllScore },
    excludeEmails: existingEmails,
    siteAnalyzer: dependencies.siteAnalyzer,
    shouldStop: async () => (await prisma.prospectingRun.findUnique({ where: { id: run.id }, select: { status: true } }))?.status === "CANCELLED",
    onOutcome: async (outcome, progress) => {
      await persistProspectingOutcome(prisma, run, outcome);
      await materializeProspectingOutcomeContacts(prisma, run, runOrganization.ownerId, outcome, progress.accepted);
      await prisma.prospectingRun.update({ where: { id: run.id }, data: { processedCount: progress.processed, acceptedCount: progress.accepted, cursor: progress.processed } });
      if (progress.processed === 1 || progress.processed - lastProgressLog >= 25 || progress.accepted >= run.targetContacts) {
        lastProgressLog = progress.processed;
        logProspecting("info", "run_progress", {
          runId: run.id,
          organizationId: run.organizationId,
          processed: progress.processed,
          accepted: progress.accepted,
          targetContacts: run.targetContacts,
        });
      }
    },
    onIssue: async (issue) => {
      const message = prospectingErrorMessage(issue.message);
      await prisma.prospectingRunIssue.create({
        data: {
          runId: run.id,
          companyId: issue.companyId,
          stage: issue.stage,
          provider: issue.provider,
          code: issue.code,
          message: message.slice(0, 2_000),
          retryable: issue.retryable,
        },
      });
      const issueKey = `${issue.stage}:${issue.provider ?? "unknown"}:${issue.code}`;
      const count = (issueCounts.get(issueKey) ?? 0) + 1;
      issueCounts.set(issueKey, count);
      if (count <= 3 || count % 25 === 0) {
        logProspecting("warn", "provider_issue", {
          runId: run.id,
          organizationId: run.organizationId,
          companyId: issue.companyId,
          stage: issue.stage,
          provider: issue.provider,
          code: issue.code,
          retryable: issue.retryable,
          occurrence: count,
          errorMessage: message,
        });
      }
    },
  });

  await materializeRunContacts(prisma, run);
  await reconcileProspectingQuotaEvents(prisma, run);

  const current = await prisma.prospectingRun.findUnique({ where: { id: run.id }, select: { status: true } });
  if (current?.status === "CANCELLED") return result;
  const completionReason = result.accepted > result.target ? "OVERSHOOT" : result.complete ? "TARGET_REACHED" : "SOURCE_EXHAUSTED";
  await prisma.prospectingRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED", completedAt: new Date(), usage: result.usage as unknown as Prisma.InputJsonValue,
      selectedCount: result.selected, processedCount: result.processed, acceptedCount: result.accepted,
      rejectedCount: result.rejected, cursor: result.processed, completionReason,
      error: result.complete ? null : "Мы проверили всю доступную выборку, но подходящих компаний оказалось меньше. Попробуйте расширить критерии.",
    },
  });
  return result;
}

async function loadFailureSnapshot(prisma: PrismaClient, runId: string) {
  try {
    const [run, issueCount, rejectedCount] = await Promise.all([
      prisma.prospectingRun.findUnique({
        where: { id: runId },
        select: { processedCount: true, acceptedCount: true },
      }),
      prisma.prospectingRunIssue.count({ where: { runId } }),
      prisma.prospectingRunCompany.count({ where: { runId, status: "REJECTED" } }),
    ]);
    return {
      processedCount: run?.processedCount ?? 0,
      acceptedCount: run?.acceptedCount ?? 0,
      rejectedCount,
      issueCount,
    };
  } catch (error) {
    const details = prospectingErrorDetails(error);
    logProspecting("error", "run_failure_snapshot_failed", {
      runId,
      errorName: details.name,
      errorCode: details.code,
      errorMessage: details.message,
    });
    return { processedCount: 0, acceptedCount: 0, rejectedCount: 0, issueCount: 0 };
  }
}

async function materializeProspectingOutcomeContacts(
  prisma: PrismaClient,
  run: ProspectingRun,
  ownerId: string,
  outcome: ProspectingPipelineResult["outcomes"][number],
  acceptedTotal: number,
) {
  if (!outcome.selectedEmails.length) return;
  const company = await prisma.company.findUnique({ where: { id: outcome.companyId } });
  if (!company) return;
  const companyData = isObject(company.data) ? company.data : null;
  const activity = publicCompanyFacts(companyData).find((fact) => fact.key === "activity")?.value;
  const segment = publicSegment(stringFromQuery(run.query, "segment"), activity);
  const companyName = publicCompanyName(company.displayName) ?? publicCompanyName(company.legalName);
  const acceptedBeforeOutcome = Math.max(0, acceptedTotal - outcome.selectedEmails.length);
  for (const [index, email] of outcome.selectedEmails.entries()) {
    const prospect = await prisma.companyProspectContact.findUnique({ where: { companyId_email: { companyId: outcome.companyId, email } } });
    if (!prospect) continue;
    const item = await prisma.contact.upsert({ where: { userId_email: { userId: ownerId, email } }, create: {
      userId: ownerId, email, name: prospect.name, company: companyName,
      segment, source: "AI_SEARCH",
      sourceCompanyId: company.id, role: prospect.role, domain: company.domain, website: company.website,
      verificationState: prospect.verificationState, verificationStatus: prospect.verificationStatus,
      verificationScore: prospect.verificationScore, verificationSource: prospect.verificationSource,
      lastValidatedAt: prospect.verifiedAt, emailValid: true, status: "ACTIVE",
    }, update: { company: companyName, segment, sourceCompanyId: company.id, role: prospect.role, verificationState: prospect.verificationState, verificationStatus: prospect.verificationStatus, verificationScore: prospect.verificationScore, lastValidatedAt: prospect.verifiedAt } });
    const operationKey = quotaKey(run.organizationId, email);
    const source = acceptedBeforeOutcome + index < run.targetContacts
      ? CONTACT_QUOTA_SOURCE.aiSearch
      : CONTACT_QUOTA_SOURCE.aiSearchBonus;
    await prisma.contactQuotaEvent.upsert({
      where: { operationKey },
      create: { organizationId: run.organizationId, userId: ownerId, operationKey, email, source, contactId: item.id, runId: run.id },
      update: { contactId: item.id },
    });
  }
}

async function persistProspectingOutcome(prisma: PrismaClient, run: ProspectingRun, outcome: ProspectingPipelineResult["outcomes"][number]) {
    const selected = outcome.selectedEmail
      ? await prisma.companyProspectContact.findUnique({ where: { companyId_email: { companyId: outcome.companyId, email: outcome.selectedEmail } }, select: { id: true } })
      : null;
    await prisma.prospectingRunCompany.upsert({
      where: { runId_companyId: { runId: run.id, companyId: outcome.companyId } },
      create: {
        runId: run.id, companyId: outcome.companyId, position: outcome.position,
        status: outcome.status, selectedContactId: selected?.id, rejectionReason: outcome.rejectionReason,
        personalizationHooks: outcome.personalizationHooks as Prisma.InputJsonValue,
        attempts: 1, startedAt: run.startedAt ?? new Date(), completedAt: new Date(),
      },
      update: {
        status: outcome.status, selectedContactId: selected?.id, rejectionReason: outcome.rejectionReason,
        personalizationHooks: outcome.personalizationHooks as Prisma.InputJsonValue,
        attempts: { increment: 1 }, completedAt: new Date(), error: null,
      },
    });
    for (const email of outcome.selectedEmails) {
      const contact = await prisma.companyProspectContact.findUnique({ where: { companyId_email: { companyId: outcome.companyId, email } }, select: { id: true } });
      if (contact) await prisma.prospectingRunContact.upsert({
        where: { runId_contactId: { runId: run.id, contactId: contact.id } },
        create: { runId: run.id, companyId: outcome.companyId, contactId: contact.id },
        update: {},
      });
    }
}

async function materializeRunContacts(prisma: PrismaClient, run: ProspectingRun) {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: run.organizationId }, select: { ownerId: true } });
  const rows = await prisma.prospectingRunContact.findMany({ where: { runId: run.id }, include: { company: true, contact: true } });
  for (const row of rows) {
    const companyData = isObject(row.company.data) ? row.company.data : null;
    const activity = publicCompanyFacts(companyData).find((fact) => fact.key === "activity")?.value;
    const segment = publicSegment(stringFromQuery(run.query, "segment"), activity);
    const companyName = publicCompanyName(row.company.displayName) ?? publicCompanyName(row.company.legalName);
    const item = await prisma.contact.upsert({
      where: { userId_email: { userId: organization.ownerId, email: row.contact.email } },
      create: {
        userId: organization.ownerId, email: row.contact.email, name: row.contact.name,
        company: companyName, segment,
        source: "AI_SEARCH", sourceCompanyId: row.companyId, role: row.contact.role,
        domain: row.company.domain, website: row.company.website, verificationState: row.contact.verificationState,
        verificationStatus: row.contact.verificationStatus, verificationScore: row.contact.verificationScore,
        verificationSource: row.contact.verificationSource, lastValidatedAt: row.contact.verifiedAt,
        emailValid: !["INVALID", "DISPOSABLE", "BLOCKED"].includes(row.contact.verificationState), status: "ACTIVE",
      },
      update: {
        name: row.contact.name, company: companyName, segment,
        sourceCompanyId: row.companyId, role: row.contact.role, domain: row.company.domain, website: row.company.website,
        verificationState: row.contact.verificationState, verificationStatus: row.contact.verificationStatus,
        verificationScore: row.contact.verificationScore, verificationSource: row.contact.verificationSource,
        lastValidatedAt: row.contact.verifiedAt,
      },
    });
    const operationKey = quotaKey(run.organizationId, item.email);
    await prisma.contactQuotaEvent.upsert({
      where: { operationKey },
      create: { organizationId: run.organizationId, userId: organization.ownerId, operationKey, email: item.email, source: CONTACT_QUOTA_SOURCE.aiSearch, contactId: item.id, runId: run.id },
      update: { contactId: item.id },
    });
  }
}

async function reconcileProspectingQuotaEvents(prisma: PrismaClient, run: ProspectingRun) {
  const events = await prisma.contactQuotaEvent.findMany({
    where: {
      runId: run.id,
      source: { in: [CONTACT_QUOTA_SOURCE.aiSearch, CONTACT_QUOTA_SOURCE.aiSearchBonus] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const chargedIds = events.slice(0, run.targetContacts).map((event) => event.id);
  const bonusIds = events.slice(run.targetContacts).map((event) => event.id);
  await prisma.$transaction([
    prisma.contactQuotaEvent.updateMany({
      where: { id: { in: chargedIds } },
      data: { source: CONTACT_QUOTA_SOURCE.aiSearch },
    }),
    prisma.contactQuotaEvent.updateMany({
      where: { id: { in: bonusIds } },
      data: { source: CONTACT_QUOTA_SOURCE.aiSearchBonus },
    }),
  ]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringFromQuery(value: Prisma.JsonValue, key: string) { return isObject(value) && typeof value[key] === "string" ? value[key] as string : undefined; }
