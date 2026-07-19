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

export type FieldKey = "email" | "name" | "company" | "segment" | "skip";

export const FIELD_LABELS: Record<FieldKey, string> = {
  email: "Email",
  name: "Имя",
  company: "Компания",
  segment: "Сегмент",
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

export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

const HINTS: Record<Exclude<FieldKey, "skip">, string[]> = {
  email: ["email", "e-mail", "mail", "почта", "мейл", "емейл", "электронная почта", "адрес"],
  name: ["name", "имя", "фио", "контакт", "контактное лицо", "клиент", "фамилия", "лпр"],
  company: ["company", "компания", "организация", "фирма", "юрлицо", "название"],
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
    for (const key of ["email", "name", "company", "segment"] as const) {
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
      const score = values.filter(isEmail).length / values.length;
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
): { email: string; name?: string; company?: string; segment?: string }[] {
  const col = (key: FieldKey) => mapping.indexOf(key);
  const emailI = col("email");
  if (emailI === -1) return [];

  const nameI = col("name");
  const companyI = col("company");
  const segmentI = col("segment");

  const out: { email: string; name?: string; company?: string; segment?: string }[] = [];
  const seen = new Set<string>();

  for (const r of data.rows) {
    const email = (r[emailI] ?? "").trim().toLowerCase();
    if (!email || !isEmail(email)) continue;
    if (seen.has(email)) continue; // дубли внутри файла — частая беда выгрузок
    seen.add(email);
    out.push({
      email,
      name: nameI > -1 ? r[nameI]?.trim() || undefined : undefined,
      company: companyI > -1 ? r[companyI]?.trim() || undefined : undefined,
      segment: segmentI > -1 ? r[segmentI]?.trim() || undefined : undefined,
    });
  }
  return out;
}
