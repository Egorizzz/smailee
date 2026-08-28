/**
 * Разбор таблицы с контактами и подбор соответствия колонок.
 *
 * Клиенты приносят базы в произвольном виде: «Почта»/«e-mail»/«Email адрес»,
 * ФИО одной колонкой или тремя, сегмент назван «ниша»/«отрасль»/«тег».
 * Раньше импорт понимал только фиксированный список заголовков и на чужом
 * файле молча возвращал ноль контактов.
 *
 * Здесь — чистые функции (парсинг + эвристика), поэтому покрыты smoke-тестами.
 * Разбор .xlsx живёт отдельно (нужен exceljs, только на сервере).
 */

export type TableData = { headers: string[]; rows: string[][] };

export type MappedContactRow = {
  email: string;
  name?: string;
  company?: string;
  inn?: string;
  segment?: string;
  customFields?: Record<string, string>;
};

export type FieldKey = "email" | "name" | "company" | "inn" | "segment" | "custom" | "skip";

export const FIELD_LABELS: Record<FieldKey, string> = {
  email: "Email",
  name: "Имя",
  company: "Компания",
  inn: "ИНН",
  segment: "Сегмент",
  custom: "Дополнительное поле",
  skip: "Не импортировать",
};

/**
 * Разбор CSV/TSV с учётом кавычек: в реальных выгрузках названия компаний
 * содержат запятые («ООО Ромашка, Плюс»), и наивный split их ломает.
 */
export function parseDelimited(text: string): TableData {
  const clean = text.replace(/^﻿/, ""); // BOM из Excel
  if (!clean.trim()) return { headers: [], rows: [] };

  const firstLine = clean.slice(0, clean.indexOf("\n") + 1 || undefined);
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"'; // экранированная кавычка внутри значения
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);

  if (rows.length === 0) return { headers: [], rows: [] };
  return { headers: rows[0], rows: rows.slice(1) };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_EXTRACT_RE = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;

export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

export function extractEmails(value: string) {
  return [...new Set((value.match(EMAIL_EXTRACT_RE) ?? []).map((email) => email.toLowerCase()))];
}

const HINTS: Record<Exclude<FieldKey, "skip" | "custom">, string[]> = {
  email: ["email", "e-mail", "mail", "почта", "мейл", "емейл", "электронная почта", "адрес"],
  name: ["name", "имя", "фио", "контакт", "контактное лицо", "клиент", "фамилия", "лпр"],
  company: ["company", "компания", "организация", "фирма", "юрлицо", "название"],
  inn: ["инн", "inn", "tax id", "taxid", "идентификатор налогоплательщика"],
  segment: ["segment", "сегмент", "ниша", "отрасль", "тег", "тэг", "категория", "группа", "сфера"],
};

/**
 * Эвристический подбор соответствия: сначала по названию колонки, затем — для
 * email — по СОДЕРЖИМОМУ. Второе важнее: колонка может называться как угодно
 * (или вообще без заголовка), но если в ней собаки и точки — это почта.
 * Работает без ИИ, поэтому импорт не ломается при недоступном LLM.
 */
export function guessMapping(data: TableData): FieldKey[] {
  const taken = new Set<FieldKey>();
  const mapping: FieldKey[] = data.headers.map(() => "skip");

  const norm = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, " ");

  data.headers.forEach((h, i) => {
    const header = norm(h);
    for (const key of ["email", "name", "company", "inn", "segment"] as const) {
      if (taken.has(key)) continue;
      if (HINTS[key].some((hint) => header === hint || header.includes(hint))) {
        mapping[i] = key;
        taken.add(key);
        return;
      }
    }
  });

  // email не нашли по заголовку — ищем колонку, где реально лежат адреса
  if (!taken.has("email")) {
    const sample = data.rows.slice(0, 20);
    let bestIdx = -1;
    let bestScore = 0;
    data.headers.forEach((_, i) => {
      const values = sample.map((r) => r[i] ?? "").filter(Boolean);
      if (values.length === 0) return;
      const score = values.filter((value) => extractEmails(value).length > 0).length / values.length;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });
    // половина значений — валидные адреса: это почта, как бы колонка ни звалась
    if (bestIdx >= 0 && bestScore >= 0.5) mapping[bestIdx] = "email";
  }

  return mapping;
}

/** Применяет соответствие колонок к строкам. Строки без валидного email отбрасываются. */
export function applyMapping(
  data: TableData,
  mapping: FieldKey[]
): MappedContactRow[] {
  const col = (key: FieldKey) => mapping.indexOf(key);
  const emailI = col("email");
  if (emailI === -1) return [];

  const nameI = col("name");
  const companyI = col("company");
  const innI = col("inn");
  const segmentI = col("segment");

  const out: MappedContactRow[] = [];
  const seen = new Set<string>();

  for (const r of data.rows) {
    const customFields = Object.fromEntries(data.headers.flatMap((header, index) =>
      mapping[index] === "custom" && r[index]?.trim() ? [[header || `Поле ${index + 1}`, r[index].trim()]] : []
    ));
    for (const email of extractEmails(r[emailI] ?? "")) {
      if (seen.has(email)) continue; // дубли внутри файла — частая беда выгрузок
      seen.add(email);
      out.push({
        email,
        name: nameI > -1 ? r[nameI]?.trim() || undefined : undefined,
        company: companyI > -1 ? r[companyI]?.trim() || undefined : undefined,
        inn: innI > -1 ? normalizeInnCell(r[innI]) : undefined,
        segment: segmentI > -1 ? r[segmentI]?.trim() || undefined : undefined,
        customFields: Object.keys(customFields).length ? customFields : undefined,
      });
    }
  }
  return out;
}

function normalizeInnCell(value: string | undefined) {
  const normalized = value?.trim().replace(/\D/g, "") ?? "";
  return /^\d{10}(?:\d{2})?$/.test(normalized) ? normalized : undefined;
}
