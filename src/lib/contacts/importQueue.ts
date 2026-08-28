import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { assessImportPersonalization, suggestSegments } from "@/lib/services/llm";
import {
  personalizationAssessmentInput,
  personalizationContextHash,
  reusablePersonalizationAssessment,
  type ImportPersonalizationAssessment,
} from "./importSafety";
import { processUploadedContact } from "./processing";
import type { WorkbookContact } from "./workbookImport";

const ITEM_BATCH = 12;
const STALE_CLAIM_MS = 15 * 60 * 1_000;

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function parsePayload(value: Prisma.JsonValue): WorkbookContact | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.email !== "string") return undefined;
  return row as unknown as WorkbookContact;
}

export async function processQueuedContactImports(prisma: PrismaClient, maxJobs = 1) {
  const results: Array<{ id: string; processed: number; completed: boolean }> = [];
  for (let jobIndex = 0; jobIndex < maxJobs; jobIndex++) {
    const job = await prisma.contactImportJob.findFirst({
      where: { status: { in: ["QUEUED", "PROCESSING"] } },
      orderBy: { createdAt: "asc" },
    });
    if (!job) break;

    await prisma.contactImportJob.update({
      where: { id: job.id },
      data: { status: "PROCESSING", startedAt: job.startedAt ?? new Date() },
    });
    await prisma.contactImportItem.updateMany({
      where: { jobId: job.id, status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
      data: { status: "PENDING", claimId: null, errorCode: null },
    });

    const pending = await prisma.contactImportItem.findMany({
      where: { jobId: job.id, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: ITEM_BATCH,
    });
    if (!pending.length) {
      const remaining = await prisma.contactImportItem.count({ where: { jobId: job.id, status: { in: ["PENDING", "PROCESSING"] } } });
      if (!remaining) await prisma.contactImportJob.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      results.push({ id: job.id, processed: 0, completed: remaining === 0 });
      continue;
    }

    const ids = pending.map((item) => item.id);
    const claimId = randomUUID();
    await prisma.contactImportItem.updateMany({ where: { id: { in: ids }, status: "PENDING" }, data: { status: "PROCESSING", claimId } });
    const claimed = await prisma.contactImportItem.findMany({ where: { claimId, status: "PROCESSING" } });
    const rows = claimed.flatMap((item) => {
      const payload = parsePayload(item.payload);
      return payload ? [{ item, payload }] : [];
    });

    const suppressed = new Set((await prisma.suppression.findMany({
      where: { userId: job.userId, releasedAt: null, email: { in: rows.map(({ payload }) => payload.email) } },
      select: { email: true },
    })).map((item) => item.email.toLowerCase()));
    const existing = await prisma.contact.findMany({
      where: { userId: job.userId, email: { in: rows.map(({ payload }) => payload.email) } },
      select: { email: true, meta: true },
    });
    const existingByEmail = new Map(existing.map((contact) => [contact.email, contact.meta]));
    const assessments: Record<string, ImportPersonalizationAssessment> = {};
    const assessmentInputs = rows.flatMap(({ item, payload }) => {
      const input = personalizationAssessmentInput(payload, item.id);
      const cached = reusablePersonalizationAssessment(existingByEmail.get(payload.email), personalizationContextHash(input));
      if (cached) { assessments[item.id] = cached; return []; }
      return [input];
    });
    if (assessmentInputs.length) Object.assign(assessments, await assessImportPersonalization({ rows: assessmentInputs }));

    const summary = jsonRecord(job.summary);
    const autoSegment = summary.autoSegment === true;
    const companies = autoSegment ? [...new Set(rows.flatMap(({ payload }) => payload.company && !payload.segment ? [payload.company] : []))] : [];
    const segmentByCompany = companies.length ? await suggestSegments({ companies }) : {};

    for (const { item, payload } of rows) {
      try {
        const processed = await processUploadedContact(prisma, {
          organizationId: job.organizationId, userId: job.userId, email: payload.email,
          name: payload.name, company: payload.company, inn: payload.inn,
          segment: payload.segment || (payload.company ? segmentByCompany[payload.company] : undefined),
          customFields: payload.customFields, suppressed: suppressed.has(payload.email),
          personalizationAssessment: assessments[item.id], prevalidated: payload.validation,
          importProvenance: payload.provenance,
        });
        await prisma.$transaction([
          prisma.contactImportItem.update({ where: { id: item.id }, data: { status: "COMPLETED", claimId: null, errorCode: null } }),
          prisma.contactImportJob.update({ where: { id: job.id }, data: {
            processedContacts: { increment: 1 },
            invalidContacts: { increment: processed.invalid ? 1 : 0 },
            siteAnalyzedContacts: { increment: processed.siteAnalyzed ? 1 : 0 },
            issueCount: { increment: processed.issues.length },
          } }),
        ]);
      } catch (error) {
        console.error("[CNT-1104] queued contact import item", { jobId: job.id, itemId: item.id, error });
        await prisma.$transaction([
          prisma.contactImportItem.update({ where: { id: item.id }, data: { status: "FAILED", claimId: null, errorCode: "CNT-1104" } }),
          prisma.contactImportJob.update({ where: { id: job.id }, data: { issueCount: { increment: 1 } } }),
        ]);
      }
    }
    // Invalid payloads fail explicitly instead of remaining stuck forever.
    const parsedIds = new Set(rows.map(({ item }) => item.id));
    const malformed = claimed.filter((item) => !parsedIds.has(item.id));
    if (malformed.length) {
      await prisma.contactImportItem.updateMany({ where: { id: { in: malformed.map((item) => item.id) } }, data: { status: "FAILED", claimId: null, errorCode: "CNT-1105" } });
      await prisma.contactImportJob.update({ where: { id: job.id }, data: { issueCount: { increment: malformed.length } } });
    }
    const remaining = await prisma.contactImportItem.count({ where: { jobId: job.id, status: { in: ["PENDING", "PROCESSING"] } } });
    if (!remaining) await prisma.contactImportJob.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    results.push({ id: job.id, processed: claimed.length, completed: remaining === 0 });
  }
  return results;
}
