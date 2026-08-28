import type { MappedContactRow, TableData } from "./tableParse";
import type { WorkbookData } from "./workbookImport";
import { createHash } from "node:crypto";

// These are abuse/cost guardrails, not product quotas. Keep product copy free of
// the exact values: a user only needs an actionable request to simplify a file.
const MAX_IMPORT_ROWS = 50_000;
const MAX_IMPORT_WORKBOOK_ROWS = 75_000;
const MAX_IMPORT_COLUMNS = 100;
const MAX_IMPORT_CELL_CHARS = 4_000;
const MAX_IMPORT_ROW_CHARS = 16_000;
const MAX_IMPORT_HEADER_CHARS = 200;
const MAX_CUSTOM_COLUMNS = 40;
const MAX_ASSESSMENT_VALUE_CHARS = 1_500;
const MAX_ASSESSMENT_ROW_CHARS = 6_000;
const MAX_ASSESSMENT_BATCH_ROWS = 60;
const MAX_ASSESSMENT_BATCH_CHARS = 60_000;
const ASSESSMENT_CACHE_MS = 180 * 24 * 60 * 60 * 1_000;

export const IMPORT_COMPLEXITY_ERROR =
  "Файл слишком большой или сложный. Уменьшите число строк, столбцов или объём текста в ячейках.";

export type ImportPersonalizationInput = {
  id: string;
  context: Record<string, string>;
};

export type ImportPersonalizationAssessment = {
  sufficient: boolean;
  confidence: number;
  reason: string;
};

export function isImportTableSafe(table: TableData) {
  if (table.rows.length > MAX_IMPORT_ROWS || table.headers.length > MAX_IMPORT_COLUMNS) return false;
  if (table.headers.some((header) => header.length > MAX_IMPORT_HEADER_CHARS)) return false;
  return table.rows.every((row) => {
    if (row.length > MAX_IMPORT_COLUMNS) return false;
    let total = 0;
    for (const cell of row) {
      if (cell.length > MAX_IMPORT_CELL_CHARS) return false;
      total += cell.length;
      if (total > MAX_IMPORT_ROW_CHARS) return false;
    }
    return true;
  });
}

export function isImportWorkbookSafe(workbook: WorkbookData) {
  return workbook.sheets.length <= 20
    && workbook.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0) <= MAX_IMPORT_WORKBOOK_ROWS
    && workbook.sheets.every(isImportTableSafe);
}

export function isImportMappingSafe(mapping: string[]) {
  return mapping.filter((field) => field === "custom").length <= MAX_CUSTOM_COLUMNS;
}

/**
 * Sends only a bounded personalization view to the classifier. The full row is
 * never interpolated into a prompt, even when a spreadsheet contains essays or
 * an unexpectedly large number of custom columns.
 */
export function personalizationAssessmentInput(row: MappedContactRow, id: string): ImportPersonalizationInput {
  const entries: Array<[string, string | undefined]> = [
    ["Имя", row.name],
    ["Компания", row.company],
    ["Сегмент", row.segment],
    ...Object.entries(row.customFields ?? {}),
  ];
  const context: Record<string, string> = {};
  let remaining = MAX_ASSESSMENT_ROW_CHARS;
  for (const [rawKey, rawValue] of entries) {
    if (!rawValue || remaining <= 0) continue;
    const key = rawKey.trim().slice(0, MAX_IMPORT_HEADER_CHARS);
    if (!key || Object.hasOwn(context, key)) continue;
    const value = rawValue.trim().slice(0, Math.min(MAX_ASSESSMENT_VALUE_CHARS, remaining));
    if (!value) continue;
    context[key] = value;
    remaining -= value.length;
  }
  return { id, context };
}

export function batchPersonalizationAssessments(rows: ImportPersonalizationInput[]) {
  const batches: ImportPersonalizationInput[][] = [];
  let current: ImportPersonalizationInput[] = [];
  let currentChars = 0;
  for (const row of rows) {
    const chars = JSON.stringify(row).length;
    if (current.length && (
      current.length >= MAX_ASSESSMENT_BATCH_ROWS
      || currentChars + chars > MAX_ASSESSMENT_BATCH_CHARS
    )) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(row);
    currentChars += chars;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function personalizationContextHash(input: ImportPersonalizationInput) {
  return createHash("sha256").update(JSON.stringify(input.context)).digest("hex");
}

export function reusablePersonalizationAssessment(
  meta: unknown,
  expectedContextHash: string,
  now = new Date(),
): ImportPersonalizationAssessment | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const audit = (meta as Record<string, unknown>).importEnrichment;
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) return undefined;
  const value = audit as Record<string, unknown>;
  if (value.contextHash !== expectedContextHash || typeof value.assessedAt !== "string") return undefined;
  const assessedAt = new Date(value.assessedAt);
  if (!Number.isFinite(assessedAt.getTime()) || now.getTime() - assessedAt.getTime() > ASSESSMENT_CACHE_MS) return undefined;
  const sufficient = value.decision === "SKIPPED_ROW_CONTEXT_SUFFICIENT"
    ? true
    : value.decision === "SITE_ENRICHMENT_REQUIRED"
      ? false
      : undefined;
  if (sufficient === undefined || typeof value.confidence !== "number") return undefined;
  return {
    sufficient,
    confidence: Math.min(1, Math.max(0, value.confidence)),
    reason: typeof value.reason === "string" ? value.reason.slice(0, 240) : "",
  };
}

export function canSkipSiteEnrichment(assessment: ImportPersonalizationAssessment | undefined) {
  return assessment?.sufficient === true && assessment.confidence >= 0.8;
}
