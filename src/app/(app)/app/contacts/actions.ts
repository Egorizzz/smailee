"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { checkUploadedContactLimit, getUploadedContactUsage, quotaDateFilter } from "@/server/limits";
import {
  parseDelimited,
  guessMapping,
  applyMapping,
  type FieldKey,
} from "@/lib/contacts/tableParse";
import { suggestFieldMapping } from "@/lib/services/llm";
import { isDemoWorkspaceActive } from "@/lib/demoWorkspace";
import { quotaKey } from "@/lib/contacts/processing";
import { effectiveCommunicationName } from "@/lib/mail/recipientPersonalization";
import { isPlanActive } from "@/lib/plans";
import {
  IMPORT_COMPLEXITY_ERROR,
  isImportMappingSafe,
  isImportTableSafe,
  isImportWorkbookSafe,
} from "@/lib/contacts/importSafety";
import { buildWorkbookContacts, type WorkbookContact, type WorkbookData } from "@/lib/contacts/workbookImport";

const FROZEN_CONTACTS_ERROR = "Доступ приостановлен. Оплатите тариф, чтобы продолжить работу с базой.";

// Простой парсер CSV (разделитель , или ;). Ожидаемые колонки (в любом
// порядке, регистронезависимо): email, name/имя, company/компания, segment/сегмент.
function parseCsv(text: string): {
  email: string;
  name?: string;
  company?: string;
  inn?: string;
  segment?: string;
}[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ""));

  const idx = (names: string[]) =>
    headers.findIndex((h) => names.includes(h));

  const emailI = idx(["email", "e-mail", "почта", "мейл"]);
  const nameI = idx(["name", "имя", "фио", "контакт"]);
  const companyI = idx(["company", "компания", "организация"]);
  const innI = idx(["inn", "инн", "tax id", "taxid"]);
  const segmentI = idx(["segment", "сегмент", "ниша", "тег"]);

  if (emailI === -1) return [];

  const rows: {
    email: string;
    name?: string;
    company?: string;
    inn?: string;
    segment?: string;
  }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]
      .split(delimiter)
      .map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const email = cells[emailI]?.toLowerCase();
    if (!email || !email.includes("@")) continue;
    rows.push({
      email,
      name: nameI > -1 ? cells[nameI] : undefined,
      company: companyI > -1 ? cells[companyI] : undefined,
      inn: innI > -1 ? cells[innI]?.replace(/\D/g, "") || undefined : undefined,
      segment: segmentI > -1 ? cells[segmentI] : undefined,
    });
  }
  return rows;
}

export async function uploadContacts(formData: FormData) {
  const workspace = await requireCapability("CONTACTS_MANAGE");
  const user = workspace.owner;
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  if (demoActive) redirect(`/app/contacts?error=${encodeURIComponent("Импорт рабочих контактов недоступен в демо-режиме")}`);
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return;

  const text = await file.text();
  const rows = parseCsv(text);

  // тарифный лимит контактов
  const limit = await checkUploadedContactLimit(user, rows.length);
  if (!limit.ok) {
    redirect(`/app/contacts?error=${encodeURIComponent(limit.error)}`);
  }

  // suppression-список пользователя — такие контакты помечаем сразу
  // (releasedAt: null — вернутые оператором вручную снова доступны)
  const suppressed = new Set(
    (
      await prisma.suppression.findMany({
        where: { userId: user.id, releasedAt: null },
        select: { email: true },
      })
    ).map((s) => s.email.toLowerCase())
  );

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  let created = 0;
  for (const r of rows) {
    const valid = emailRe.test(r.email);
    const isSuppressed = suppressed.has(r.email.toLowerCase());
    const status = isSuppressed
      ? "UNSUBSCRIBED"
      : valid
      ? "ACTIVE"
      : "INVALID";
    try {
      await prisma.contact.upsert({
        where: { userId_email: { userId: user.id, email: r.email } },
        update: {
          name: r.name,
          company: r.company,
          segment: r.segment,
          emailValid: valid,
          status,
          ...(demoActive ? { isDemo: true } : {}),
        },
        create: {
          userId: user.id,
          email: r.email,
          name: r.name,
          company: r.company,
          segment: r.segment,
          emailValid: valid,
          status,
          isDemo: demoActive,
        },
      });
      created++;
    } catch {
      // пропускаем битые строки
    }
  }
  revalidatePath("/app/contacts");
}

/** Читает все листы книги. CSV/TSV представляется как книга с одним листом. */
async function readWorkbook(file: File): Promise<WorkbookData> {
  const isXlsx =
    /\.xlsx$/i.test(file.name) ||
    file.type.includes("spreadsheet") ||
    file.type.includes("excel");

  if (!isXlsx) return { sheets: [{ name: "Контакты", ...parseDelimited(await file.text()) }] };

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  return {
    sheets: wb.worksheets.flatMap((ws) => {
      const grid: string[][] = [];
      ws.eachRow((row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        grid.push(values.map(excelCellText));
      });
      return grid.length ? [{ name: ws.name, headers: grid[0], rows: grid.slice(1) }] : [];
    }),
  };
}

function excelCellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value).trim();
  const cell = value as { text?: unknown; result?: unknown; hyperlink?: unknown; richText?: Array<{ text?: unknown }> };
  if (cell.text != null) return String(cell.text).trim();
  if (cell.result != null) return excelCellText(cell.result);
  if (Array.isArray(cell.richText)) return cell.richText.map((part) => String(part.text ?? "")).join("").trim();
  if (cell.hyperlink != null) return String(cell.hyperlink).trim();
  return String(value).trim();
}

export type ImportAnalysis = {
  error?: string;
  headers: string[];
  sampleRows: string[][];
  mapping: FieldKey[];
  totalRows: number;
  /** Есть ли в файле колонка сегмента — если нет, предложим автосегментацию. */
  hasSegment: boolean;
  aiUsed: boolean;
  workbook?: {
    contacts: number;
    prevalidated: number;
    unmatchedContextRows: number;
    sheets: ReturnType<typeof buildWorkbookContacts>["sheets"];
  };
};

/**
 * Шаг 1 импорта: разобрать файл и предложить соответствие колонок.
 * Ничего не сохраняет — пользователь сначала подтверждает разметку.
 * Эвристика отрабатывает всегда, ИИ подключается только к колонкам, которые
 * она не опознала (экономит вызов и не ломает импорт при недоступном LLM).
 */
export async function analyzeContactsFile(formData: FormData): Promise<ImportAnalysis> {
  const workspace = await requireCapability("CONTACTS_VIEW");
  const empty: ImportAnalysis = {
    headers: [],
    sampleRows: [],
    mapping: [],
    totalRows: 0,
    hasSegment: false,
    aiUsed: false,
  };
  if (await isDemoWorkspaceActive(workspace.organizationId)) {
    return { ...empty, error: "Импорт рабочих контактов недоступен в демо-режиме" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...empty, error: "Выберите файл с базой" };
  }
  if (file.size > 10_000_000) {
    return { ...empty, error: IMPORT_COMPLEXITY_ERROR };
  }

  let workbook: WorkbookData;
  try {
    workbook = await readWorkbook(file);
  } catch {
    return { ...empty, error: "Не удалось прочитать файл. Поддерживаются CSV, TSV и XLSX." };
  }

  if (!isImportWorkbookSafe(workbook)) return { ...empty, error: IMPORT_COMPLEXITY_ERROR };
  if (workbook.sheets.length > 1) {
    let result: ReturnType<typeof buildWorkbookContacts>;
    try { result = buildWorkbookContacts(workbook); }
    catch { return { ...empty, error: IMPORT_COMPLEXITY_ERROR }; }
    if (!result.contacts.length) return { ...empty, error: "Не удалось найти контакты с корректными email" };
    const first = workbook.sheets.find((sheet) => result.sheets.find((summary) => summary.name === sheet.name)?.role === "contacts")!;
    return {
      headers: first.headers,
      sampleRows: first.rows.slice(0, 5),
      mapping: guessMapping(first),
      totalRows: result.contacts.length,
      hasSegment: result.contacts.some((contact) => Boolean(contact.segment)),
      aiUsed: false,
      workbook: {
        contacts: result.contacts.length,
        prevalidated: result.prevalidated,
        unmatchedContextRows: result.unmatchedContextRows,
        sheets: result.sheets,
      },
    };
  }

  const table = workbook.sheets[0] ?? { headers: [], rows: [] };

  if (table.headers.length === 0) {
    return { ...empty, error: "Файл пуст или не похож на таблицу" };
  }
  if (!isImportTableSafe(table)) return { ...empty, error: IMPORT_COMPLEXITY_ERROR };

  const mapping = guessMapping(table);
  let aiUsed = false;

  // ИИ зовём, только если эвристика не нашла email или осталось много
  // неопознанных колонок — на типовом файле он не нужен
  const unresolved = mapping.filter((m) => m === "skip").length;
  if (!mapping.includes("email") || unresolved > 1) {
    const ai = await suggestFieldMapping({ headers: table.headers, sampleRows: table.rows.slice(0, 5) });
    const valid: FieldKey[] = ["email", "name", "company", "inn", "segment", "custom", "skip"];
    for (const [k, v] of Object.entries(ai)) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= mapping.length) continue;
      if (!valid.includes(v as FieldKey)) continue;
      // эвристике доверяем больше: перезаписываем только то, что она не поняла
      if (mapping[i] === "skip") {
        mapping[i] = v as FieldKey;
        aiUsed = true;
      }
    }
  }

  // Неизвестные непустые колонки не теряем: пользователь может явно выбрать
  // «Не импортировать» в предпросмотре, но по умолчанию это дополнительные поля.
  mapping.forEach((value, index) => {
    if (value === "skip" && table.rows.some((row) => Boolean(row[index]?.trim()))) mapping[index] = "custom";
  });

  return {
    headers: table.headers,
    sampleRows: table.rows.slice(0, 5),
    mapping,
    totalRows: table.rows.length,
    hasSegment: mapping.includes("segment"),
    aiUsed,
  };
}

/**
 * Шаг 2 импорта: применить подтверждённое соответствие колонок.
 * Файл перечитывается заново — держать таблицу между запросами негде, а
 * гонять её через скрытое поле формы означало бы тащить мегабайты в браузер
 * и обратно.
 */
export async function importContactsMapped(
  formData: FormData
): Promise<{ ok?: string; error?: string; code?: string; invalidEmails?: string[]; siteAnalyzed?: number; partialIssues?: number; segmentMerges?: Array<{ from: string; to: string }> }> {
  const workspace = await requireCapability("CONTACTS_MANAGE");
  const user = workspace.owner;
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  if (demoActive) return { error: "Импорт рабочих контактов недоступен в демо-режиме" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Файл не передан" };
  if (file.size > 10_000_000) return { error: IMPORT_COMPLEXITY_ERROR };

  const mapping = formData.getAll("mapping").map(String) as FieldKey[];
  const autoSegment = formData.get("autoSegment") === "on";

  let workbook: WorkbookData;
  try {
    workbook = await readWorkbook(file);
  } catch {
    return { error: "Не удалось прочитать файл" };
  }
  if (!isImportWorkbookSafe(workbook)) return { error: IMPORT_COMPLEXITY_ERROR };

  let rows: WorkbookContact[];
  let workbookSummary: ReturnType<typeof buildWorkbookContacts> | undefined;
  if (workbook.sheets.length > 1) {
    try { workbookSummary = buildWorkbookContacts(workbook); }
    catch { return { error: IMPORT_COMPLEXITY_ERROR }; }
    rows = workbookSummary.contacts;
  } else {
    const table = workbook.sheets[0] ?? { headers: [], rows: [] };
    if (!isImportTableSafe(table) || !isImportMappingSafe(mapping)) return { error: IMPORT_COMPLEXITY_ERROR };
    rows = applyMapping(table, mapping).map((row, index) => ({
      ...row,
      provenance: [{ sheet: workbook.sheets[0]?.name ?? "Контакты", row: index + 2, matchedBy: "email" as const }],
    }));
  }
  if (rows.length === 0) {
    return { error: "Не найдено ни одного контакта с корректным email — проверьте разметку колонок" };
  }

  const operationKeys = rows.map((row) => quotaKey(workspace.organizationId!, row.email));
  const alreadyProcessed = await prisma.contactQuotaEvent.count({ where: { operationKey: { in: operationKeys } } });
  const limit = await checkUploadedContactLimit(user, Math.max(0, rows.length - alreadyProcessed));
  if (!limit.ok) return { error: limit.error };
  const usageBeforeQueue = await getUploadedContactUsage(user);
  const quotaCreatedAt = await quotaDateFilter(user);
  const eventsBeforeQueue = await prisma.contactQuotaEvent.count({ where: {
    organizationId: workspace.organizationId!, createdAt: quotaCreatedAt, source: { not: "AI_SEARCH" },
  } });

  try {
    await prisma.$transaction(async (tx) => {
      // Serializes quota reservations for one organization. Without this lock,
      // two simultaneous books could both pass the read-only limit check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspace.organizationId!}))`;
      const [reservedForBook, currentEvents] = await Promise.all([
        tx.contactQuotaEvent.count({ where: { operationKey: { in: operationKeys } } }),
        tx.contactQuotaEvent.count({ where: {
          organizationId: workspace.organizationId!, createdAt: quotaCreatedAt, source: { not: "AI_SEARCH" },
        } }),
      ]);
      const concurrentReservations = Math.max(0, currentEvents - eventsBeforeQueue);
      if (usageBeforeQueue.used + concurrentReservations + Math.max(0, rows.length - reservedForBook) > usageBeforeQueue.limit) {
        throw new Error("CONTACT_UPLOAD_LIMIT");
      }
      const job = await tx.contactImportJob.create({ data: {
        organizationId: workspace.organizationId!, userId: user.id, fileName: file.name,
        sourceRows: workbook.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
        totalContacts: rows.length,
        prevalidatedContacts: rows.filter((row) => Boolean(row.validation)).length,
        summary: JSON.parse(JSON.stringify({
          autoSegment,
          sheets: workbookSummary?.sheets ?? [],
          schemas: workbook.sheets.map((sheet) => ({ name: sheet.name, headers: sheet.headers })),
          unmatchedRows: workbookSummary?.unmatchedRows ?? [],
          referenceRows: workbookSummary ? workbook.sheets
            .filter((sheet) => workbookSummary!.sheets.find((summary) => summary.name === sheet.name)?.role === "reference")
            .map((sheet) => ({ name: sheet.name, rows: sheet.rows })) : [],
        })) as Prisma.InputJsonValue,
      } });
      await tx.contactImportItem.createMany({ data: rows.map((row) => ({
        jobId: job.id, email: row.email,
        payload: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue,
      })) });
      await tx.contactQuotaEvent.createMany({
        skipDuplicates: true,
        data: rows.map((row) => ({
          organizationId: workspace.organizationId!, userId: user.id,
          operationKey: quotaKey(workspace.organizationId!, row.email),
          email: row.email, source: "USER_UPLOAD",
        })),
      });
    }, { timeout: 30_000 });
  } catch (error) {
    if (error instanceof Error && error.message === "CONTACT_UPLOAD_LIMIT") {
      const refreshed = await checkUploadedContactLimit(user, rows.length);
      return { error: refreshed.ok ? "На текущем тарифе больше загрузить нельзя. Чтобы продолжить, перейдите на тариф выше." : refreshed.error };
    }
    console.error("[CNT-1103] contact import queue", { fileName: file.name, error });
    return { error: "Не удалось поставить базу в обработку. Попробуйте ещё раз.", code: "CNT-1103" };
  }

  revalidatePath("/app/contacts");
  return { ok: `База принята: ${rows.length} контактов. Обработка продолжится в фоне.` };
}

export async function mergeContactSegments(formData: FormData): Promise<{ ok?: true; error?: string }> {
  const workspace = await requireCapability("CONTACTS_MANAGE");
  if (!isPlanActive(workspace.owner.plan, workspace.owner.planExpiresAt)) return { error: FROZEN_CONTACTS_ERROR };
  const from = String(formData.get("from") || "").trim(); const to = String(formData.get("to") || "").trim();
  if (!from || !to || from === to) return { error: "Не удалось объединить сегменты" };
  await prisma.contact.updateMany({ where: { userId: workspace.owner.id, segment: from }, data: { segment: to } });
  revalidatePath("/app/contacts"); return { ok: true };
}

export async function deleteInvalidContacts(formData: FormData): Promise<{ ok?: true; error?: string }> {
  const workspace = await requireCapability("CONTACTS_MANAGE");
  if (!isPlanActive(workspace.owner.plan, workspace.owner.planExpiresAt)) return { error: FROZEN_CONTACTS_ERROR };
  let emails: string[] = [];
  try { const value = JSON.parse(String(formData.get("emails") || "[]")); if (Array.isArray(value)) emails = value.filter((item): item is string => typeof item === "string").slice(0, 5_000); } catch { return { error: "Не удалось прочитать список адресов" }; }
  await prisma.contact.deleteMany({ where: { userId: workspace.owner.id, email: { in: emails }, status: "INVALID" } });
  revalidatePath("/app/contacts"); return { ok: true };
}

export async function deleteContact(formData: FormData): Promise<{ ok?: true; error?: string; code?: string }> {
  const workspace = await requireCapability("CONTACTS_MANAGE");
  if (!isPlanActive(workspace.owner.plan, workspace.owner.planExpiresAt)) return { error: FROZEN_CONTACTS_ERROR, code: "BILL-1002" };
  const id = String(formData.get("id") || "");
  const contact = await prisma.contact.findFirst({ where: { id, userId: workspace.owner.id } });
  if (!contact) return { error: "Контакт не найден", code: "CNT-1404" };
  await prisma.contact.delete({ where: { id: contact.id } });
  revalidatePath("/app/contacts");
  return { ok: true };
}

export async function updateContactPersonalization(formData: FormData): Promise<{
  ok?: true;
  error?: string;
  code?: string;
  name?: string | null;
  company?: string | null;
  communicationNameOverride?: string | null;
}> {
  const workspace = await requireCapability("CONTACTS_MANAGE");
  if (!isPlanActive(workspace.owner.plan, workspace.owner.planExpiresAt)) return { error: FROZEN_CONTACTS_ERROR, code: "BILL-1002" };
  const id = String(formData.get("id") || "");
  const contact = await prisma.contact.findFirst({
    where: { id, userId: workspace.owner.id },
    include: { sourceCompany: true },
  });
  if (!contact) return { error: "Контакт не найден", code: "CNT-1404" };

  const name = String(formData.get("name") || "").trim().replace(/\s+/g, " ").slice(0, 200) || null;
  const submittedCompany = String(formData.get("companyName") || "").trim().replace(/\s+/g, " ").slice(0, 300);
  const autoCompany = effectiveCommunicationName({
    communicationName: contact.sourceCompany?.communicationName,
    communicationNameConfidence: contact.sourceCompany?.communicationNameConfidence,
  });
  const communicationNameOverride = submittedCompany && submittedCompany === autoCompany ? null : submittedCompany;

  try {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { name, communicationNameOverride },
    });
    revalidatePath("/app/contacts");
    return {
      ok: true,
      name,
      communicationNameOverride,
      company: effectiveCommunicationName({
        communicationNameOverride,
        communicationName: contact.sourceCompany?.communicationName,
        communicationNameConfidence: contact.sourceCompany?.communicationNameConfidence,
      }),
    };
  } catch (error) {
    console.error("[CNT-1501] update contact personalization", { id, error });
    return { error: "Не удалось сохранить изменения. Попробуйте ещё раз.", code: "CNT-1501" };
  }
}

export async function markContactIrrelevant(formData: FormData): Promise<{ ok?: true; error?: string; code?: string }> {
  const workspace = await requireCapability("CONTACTS_MANAGE");
  if (!isPlanActive(workspace.owner.plan, workspace.owner.planExpiresAt)) return { error: FROZEN_CONTACTS_ERROR, code: "BILL-1002" };
  const id = String(formData.get("id") || "");
  const reason = String(formData.get("reason") || "").trim().slice(0, 1_000) || null;
  const contact = await prisma.contact.findFirst({
    where: { id, userId: workspace.owner.id }, include: { sourceCompany: true },
  });
  if (!contact) return { error: "Контакт не найден", code: "CNT-1404" };
  await prisma.$transaction([
    prisma.contact.update({ where: { id }, data: { relevanceStatus: "IRRELEVANT", irrelevanceReason: reason } }),
    prisma.contactRelevanceFeedback.create({ data: {
      organizationId: workspace.organizationId!, userId: workspace.owner.id, contactId: id,
      companyId: contact.sourceCompanyId, email: contact.email, reason,
      companySnapshot: contact.sourceCompany ? { displayName: contact.sourceCompany.displayName, domain: contact.sourceCompany.domain, data: contact.sourceCompany.data } : { company: contact.company, domain: contact.domain },
    } }),
  ]);
  revalidatePath("/app/contacts");
  return { ok: true };
}

export async function clearContacts() {
  const workspace = await requireCapability("CONTACTS_MANAGE");
  if (!isPlanActive(workspace.owner.plan, workspace.owner.planExpiresAt)) return;
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  await prisma.contact.deleteMany({ where: { userId: workspace.owner.id, isDemo: demoActive } });
  revalidatePath("/app/contacts");
}

/**
 * Вернуть контакт из стоп-листа в рассылку — «отказался полгода назад,
 * возможно сейчас актуально». Мягкое снятие (releasedAt), а не удаление
 * строки: история отказов не теряется, видна в БД, если понадобится.
 *
 * Снимает ОБА барьера отправки разом: Suppression.releasedAt (проверяется в
 * sendEngine/contacts при импорте) и Contact.status обратно на ACTIVE — тот
 * же второй барьер, который выставляется при явном отказе в переписке
 * (см. inboundEngine.ts). Один без другого контакт остался бы заблокирован.
 */
export async function releaseSuppression(formData: FormData) {
  const workspace = await requireCapability("CONTACTS_MANAGE");
  if (!isPlanActive(workspace.owner.plan, workspace.owner.planExpiresAt)) return;
  if (await isDemoWorkspaceActive(workspace.organizationId)) return;
  const user = workspace.owner;
  const id = String(formData.get("id") || "");

  const record = await prisma.suppression.findFirst({ where: { id, userId: user.id } });
  if (!record) return;

  await prisma.suppression.update({
    where: { id: record.id },
    data: { releasedAt: new Date() },
  });
  await prisma.contact.updateMany({
    where: { userId: user.id, email: record.email },
    data: { status: "ACTIVE" },
  });

  revalidatePath("/app/contacts");
}
