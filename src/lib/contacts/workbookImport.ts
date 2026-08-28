import type { EmailVerificationState } from "@prisma/client";
import { extractEmails, type MappedContactRow, type TableData } from "./tableParse";
export { extractEmails } from "./tableParse";

export type WorkbookSheet = TableData & { name: string };
export type WorkbookData = { sheets: WorkbookSheet[] };

export type ImportedValidation = {
  state: EmailVerificationState;
  status: string;
  source: string;
  score?: number;
  validatedAt?: string;
};

export type WorkbookContact = MappedContactRow & {
  validation?: ImportedValidation;
  provenance: Array<{ sheet: string; row: number; matchedBy: "email" | "inn" | "website" | "phone" }>;
};

export type WorkbookSheetSummary = {
  name: string;
  role: "contacts" | "email_validation" | "reference";
  rows: number;
  rowsMatched: number;
};

export type WorkbookImportResult = {
  contacts: WorkbookContact[];
  sheets: WorkbookSheetSummary[];
  sourceRows: number;
  prevalidated: number;
  unmatchedContextRows: number;
  /** Retained verbatim for later manual/agent-assisted resolution. */
  unmatchedRows: Array<{ sheet: string; row: number; values: string[] }>;
};

const MAX_MERGED_CONTACT_CHARS = 100_000;
const MAX_SOURCE_ROWS_PER_CONTACT = 250;

function norm(value: string) {
  return value.trim().toLowerCase().replace(/ё/g, "е").replace(/[_.,:;()\[\]{}\-/\\]+/g, " ").replace(/\s+/g, " ");
}

function includesAny(value: string, hints: string[]) {
  const normalized = norm(value);
  return hints.some((hint) => normalized === hint || normalized.includes(hint));
}

const EMAIL_HEADERS = ["email", "e mail", "почта", "мейл", "email адрес"];
const INN_HEADERS = ["инн", "tax id", "taxid"];
const WEBSITE_HEADERS = ["сайт", "website", "url", "домен"];
const PHONE_HEADERS = ["телефон", "mobile", "phone", "whatsapp"];
const VALIDATION_HEADERS = ["валидность", "доставляемость", "catch all", "catchall", "одноразовый", "email активен", "email проверен", "validated", "verification status"];

function sheetRole(sheet: WorkbookSheet): WorkbookSheetSummary["role"] {
  const hasEmailHeader = sheet.headers.some((header) => includesAny(header, EMAIL_HEADERS));
  const validationColumns = sheet.headers.filter((header) => includesAny(header, VALIDATION_HEADERS)).length;
  if (includesAny(sheet.name, ["email валидатор", "email validation", "validation report"])) return hasEmailHeader ? "email_validation" : "reference";
  if (hasEmailHeader && validationColumns >= 2) return "email_validation";
  const sampleHasEmail = sheet.rows.slice(0, 30).some((row) => row.some((cell) => extractEmails(cell).length > 0));
  const hasStrongContactKey = sheet.headers.some((header) => includesAny(header, [...INN_HEADERS, ...WEBSITE_HEADERS, ...PHONE_HEADERS]));
  return sampleHasEmail || hasEmailHeader || hasStrongContactKey ? "contacts" : "reference";
}

function indexes(headers: string[], hints: string[]) {
  return headers.flatMap((header, index) => includesAny(header, hints) ? [index] : []);
}

function valuesAt(row: string[], indices: number[]) {
  return indices.map((index) => row[index]?.trim()).filter((value): value is string => Boolean(value));
}

function firstAt(row: string[], headers: string[], hints: string[]) {
  return valuesAt(row, indexes(headers, hints))[0];
}

function normalizeInn(value: string | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return /^\d{10}(?:\d{2})?$/.test(digits) ? digits : undefined;
}

function normalizeWebsiteKey(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "") || undefined;
  } catch { return undefined; }
}

function normalizePhone(value: string | undefined) {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits.slice(-10) : undefined;
}

function rawFields(sheet: WorkbookSheet, row: string[]) {
  const fields: Record<string, string> = {};
  sheet.headers.forEach((header, index) => {
    const value = row[index]?.trim();
    if (!value) return;
    fields[`${sheet.name} · ${header || `Поле ${index + 1}`}`] = value;
  });
  return fields;
}

function appendValue(target: Record<string, string>, key: string, value: string) {
  const existing = target[key];
  if (!existing) target[key] = value;
  else if (!existing.split("\n").includes(value)) target[key] = `${existing}\n${value}`;
}

function mergeRaw(target: WorkbookContact, fields: Record<string, string>) {
  target.customFields ??= {};
  for (const [key, value] of Object.entries(fields)) appendValue(target.customFields, key, value);
}

function appendCanonical(current: string | undefined, value: string | undefined) {
  if (!value) return current;
  if (!current) return value;
  const variants = current.split(" · ");
  return variants.includes(value) ? current : `${current} · ${value}`;
}

function validationFromRow(sheet: WorkbookSheet, row: string[]): ImportedValidation {
  const get = (hints: string[]) => firstAt(row, sheet.headers, hints)?.trim();
  const validity = get(["валидность", "validity", "email проверен", "validated", "verification status"]);
  const deliverable = get(["доставляемость", "deliverability"]);
  const active = get(["email активен", "active"]);
  const disposable = get(["одноразовый", "disposable", "dea"]);
  const catchAll = get(["catch all", "catchall"]);
  const reliability = get(["надежность", "reliability", "score"]);
  const no = (value?: string) => value ? /^(нет|no|false|0|invalid)$/i.test(value.trim()) : false;
  const yes = (value?: string) => value ? /^(да|yes|true|1|valid)$/i.test(value.trim()) : false;

  let state: EmailVerificationState = "UNKNOWN";
  if (yes(disposable)) state = "DISPOSABLE";
  else if (no(deliverable) || no(validity) || no(active)) state = "INVALID";
  else if (yes(catchAll)) state = "ACCEPT_ALL";
  else if (yes(deliverable) || yes(validity) || yes(active)) state = "VALID";

  const numericScore = reliability ? Number(reliability.replace(",", ".").replace(/[^\d.]/g, "")) : NaN;
  return {
    state,
    status: [validity, deliverable, active, catchAll].filter(Boolean).join("; ") || "declared_validated",
    source: `upload:${sheet.name}`,
    score: Number.isFinite(numericScore) ? Math.max(0, Math.min(100, Math.round(numericScore))) : undefined,
    validatedAt: get(["дата проверки", "проверено", "validated at", "validation date"]),
  };
}

function mergeValidation(current: ImportedValidation | undefined, incoming: ImportedValidation) {
  if (!current) return incoming;
  const priority: Record<EmailVerificationState, number> = {
    BLOCKED: 9, DISPOSABLE: 8, INVALID: 7, ACCEPT_ALL: 6, VALID: 5,
    WEBMAIL: 4, UNKNOWN: 3, UNVERIFIED: 2, PENDING: 1, CLAIMED: 0,
  };
  return priority[incoming.state] > priority[current.state] ? incoming : current;
}

function uniqueOwner(map: Map<string, Set<string>>, key: string | undefined) {
  if (!key) return undefined;
  const owners = map.get(key);
  return owners?.size === 1 ? [...owners][0] : undefined;
}

/**
 * Builds one lossless contact projection from every useful worksheet. Exact
 * email is the canonical identity. Email-less rows may only enrich a contact
 * through an unambiguous strong key; fuzzy names never merge contacts.
 */
export function buildWorkbookContacts(workbook: WorkbookData): WorkbookImportResult {
  const contacts = new Map<string, WorkbookContact>();
  const validations = new Map<string, ImportedValidation>();
  const validationRows = new Map<string, Array<{ fields: Record<string, string>; sheet: string; row: number }>>();
  const summaries: WorkbookSheetSummary[] = workbook.sheets.map((sheet) => ({
    name: sheet.name, role: sheetRole(sheet), rows: sheet.rows.length, rowsMatched: 0,
  }));
  const deferred: Array<{ sheet: WorkbookSheet; row: string[]; rowNumber: number; summary: WorkbookSheetSummary }> = [];

  workbook.sheets.forEach((sheet, sheetIndex) => {
    const summary = summaries[sheetIndex];
    const emailColumns = indexes(sheet.headers, EMAIL_HEADERS);
    sheet.rows.forEach((row, rowIndex) => {
      if (summary.role === "reference") return;
      const emails = [...new Set((emailColumns.length ? valuesAt(row, emailColumns) : row).flatMap(extractEmails))];
      if (summary.role === "email_validation") {
        for (const email of emails) {
          validations.set(email, mergeValidation(validations.get(email), validationFromRow(sheet, row)));
          const sources = validationRows.get(email) ?? [];
          sources.push({ fields: rawFields(sheet, row), sheet: sheet.name, row: rowIndex + 2 });
          validationRows.set(email, sources);
        }
        if (emails.length) summary.rowsMatched++;
        return;
      }
      if (!emails.length) {
        deferred.push({ sheet, row, rowNumber: rowIndex + 2, summary });
        return;
      }
      const fields = rawFields(sheet, row);
      const rowValidation = sheet.headers.some((header) => includesAny(header, VALIDATION_HEADERS))
        ? validationFromRow(sheet, row)
        : undefined;
      for (const email of emails) {
        const contact = contacts.get(email) ?? { email, provenance: [], customFields: {} };
        contact.name = appendCanonical(contact.name, firstAt(row, sheet.headers, ["фио", "контактное лицо", "имя", "name"]));
        contact.company = appendCanonical(contact.company, firstAt(row, sheet.headers, ["название", "названия", "компания", "организация", "company"]));
        contact.inn ??= normalizeInn(firstAt(row, sheet.headers, INN_HEADERS));
        contact.segment = appendCanonical(contact.segment, firstAt(row, sheet.headers, ["категория", "категории", "сегмент", "отрасль", "ниша"]));
        mergeRaw(contact, fields);
        contact.provenance.push({ sheet: sheet.name, row: rowIndex + 2, matchedBy: "email" });
        if (rowValidation) validations.set(email, mergeValidation(validations.get(email), rowValidation));
        contacts.set(email, contact);
      }
      summary.rowsMatched++;
    });
  });

  const byInn = new Map<string, Set<string>>();
  const byWebsite = new Map<string, Set<string>>();
  const byPhone = new Map<string, Set<string>>();
  const addKey = (map: Map<string, Set<string>>, key: string | undefined, email: string) => {
    if (!key) return;
    const owners = map.get(key) ?? new Set<string>(); owners.add(email); map.set(key, owners);
  };
  for (const contact of contacts.values()) {
    addKey(byInn, contact.inn, contact.email);
    for (const [key, value] of Object.entries(contact.customFields ?? {})) {
      if (includesAny(key, WEBSITE_HEADERS)) addKey(byWebsite, normalizeWebsiteKey(value), contact.email);
      if (includesAny(key, PHONE_HEADERS)) addKey(byPhone, normalizePhone(value), contact.email);
    }
  }

  let unmatchedContextRows = 0;
  const unmatchedRows: WorkbookImportResult["unmatchedRows"] = [];
  for (const item of deferred) {
    const inn = normalizeInn(firstAt(item.row, item.sheet.headers, INN_HEADERS));
    const website = normalizeWebsiteKey(firstAt(item.row, item.sheet.headers, WEBSITE_HEADERS));
    const phone = normalizePhone(firstAt(item.row, item.sheet.headers, PHONE_HEADERS));
    const candidates = [uniqueOwner(byInn, inn), uniqueOwner(byWebsite, website), uniqueOwner(byPhone, phone)].filter((v): v is string => Boolean(v));
    const unique = [...new Set(candidates)];
    if (unique.length !== 1) {
      unmatchedContextRows++;
      unmatchedRows.push({ sheet: item.sheet.name, row: item.rowNumber, values: item.row });
      continue;
    }
    const contact = contacts.get(unique[0]);
    if (!contact) {
      unmatchedContextRows++;
      unmatchedRows.push({ sheet: item.sheet.name, row: item.rowNumber, values: item.row });
      continue;
    }
    mergeRaw(contact, rawFields(item.sheet, item.row));
    const matchedBy = inn && uniqueOwner(byInn, inn) === contact.email ? "inn" : website && uniqueOwner(byWebsite, website) === contact.email ? "website" : "phone";
    contact.provenance.push({ sheet: item.sheet.name, row: item.rowNumber, matchedBy });
    item.summary.rowsMatched++;
  }

  let prevalidated = 0;
  for (const contact of contacts.values()) {
    contact.validation = validations.get(contact.email);
    if (contact.validation) prevalidated++;
    for (const source of validationRows.get(contact.email) ?? []) {
      mergeRaw(contact, source.fields);
      contact.provenance.push({ sheet: source.sheet, row: source.row, matchedBy: "email" });
    }
    if (!Object.keys(contact.customFields ?? {}).length) delete contact.customFields;
    if (contact.provenance.length > MAX_SOURCE_ROWS_PER_CONTACT || JSON.stringify(contact.customFields ?? {}).length > MAX_MERGED_CONTACT_CHARS) {
      throw new Error("CONTACT_IMPORT_COMPLEXITY");
    }
  }
  return {
    contacts: [...contacts.values()], sheets: summaries,
    sourceRows: workbook.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
    prevalidated, unmatchedContextRows, unmatchedRows,
  };
}
