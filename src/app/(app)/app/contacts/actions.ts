"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkContactLimit } from "@/server/limits";
import {
  parseDelimited,
  guessMapping,
  applyMapping,
  type TableData,
  type FieldKey,
} from "@/lib/contacts/tableParse";
import { suggestFieldMapping, suggestSegments } from "@/lib/services/llm";

// Простой парсер CSV (разделитель , или ;). Ожидаемые колонки (в любом
// порядке, регистронезависимо): email, name/имя, company/компания, segment/сегмент.
function parseCsv(text: string): {
  email: string;
  name?: string;
  company?: string;
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
  const segmentI = idx(["segment", "сегмент", "ниша", "тег"]);

  if (emailI === -1) return [];

  const rows: {
    email: string;
    name?: string;
    company?: string;
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
      segment: segmentI > -1 ? cells[segmentI] : undefined,
    });
  }
  return rows;
}

export async function uploadContacts(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return;

  const text = await file.text();
  const rows = parseCsv(text);

  // тарифный лимит контактов
  const limit = await checkContactLimit(user, rows.length);
  if (!limit.ok) {
    redirect(`/app/contacts?error=${encodeURIComponent(limit.error)}`);
  }

  // suppression-список пользователя — такие контакты помечаем сразу
  const suppressed = new Set(
    (
      await prisma.suppression.findMany({
        where: { userId: user.id },
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
        },
        create: {
          userId: user.id,
          email: r.email,
          name: r.name,
          company: r.company,
          segment: r.segment,
          emailValid: valid,
          status,
        },
      });
      created++;
    } catch {
      // пропускаем битые строки
    }
  }
  revalidatePath("/app/contacts");
}

/**
 * Читает загруженный файл в таблицу. .xlsx разбирается exceljs (серверная
 * библиотека, поэтому только здесь), остальное — как текст с разделителями.
 */
async function readTable(file: File): Promise<TableData> {
  const isXlsx =
    /\.xlsx?$/i.test(file.name) ||
    file.type.includes("spreadsheet") ||
    file.type.includes("excel");

  if (!isXlsx) return parseDelimited(await file.text());

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const grid: string[][] = [];
  ws.eachRow((row) => {
    const cells: string[] = [];
    // values[0] всегда пуст (exceljs индексирует колонки с 1)
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    for (const v of values) {
      if (v == null) cells.push("");
      else if (typeof v === "object" && "text" in v) cells.push(String(v.text ?? ""));
      else if (typeof v === "object" && "result" in v) cells.push(String(v.result ?? ""));
      else cells.push(String(v));
    }
    grid.push(cells.map((c) => c.trim()));
  });

  if (grid.length === 0) return { headers: [], rows: [] };
  return { headers: grid[0], rows: grid.slice(1) };
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
};

/**
 * Шаг 1 импорта: разобрать файл и предложить соответствие колонок.
 * Ничего не сохраняет — пользователь сначала подтверждает разметку.
 * Эвристика отрабатывает всегда, ИИ подключается только к колонкам, которые
 * она не опознала (экономит вызов и не ломает импорт при недоступном LLM).
 */
export async function analyzeContactsFile(formData: FormData): Promise<ImportAnalysis> {
  await requireUser();
  const empty: ImportAnalysis = {
    headers: [],
    sampleRows: [],
    mapping: [],
    totalRows: 0,
    hasSegment: false,
    aiUsed: false,
  };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...empty, error: "Выберите файл с базой" };
  }
  if (file.size > 10_000_000) {
    return { ...empty, error: "Файл больше 10 МБ — разбейте базу на части" };
  }

  let table: TableData;
  try {
    table = await readTable(file);
  } catch {
    return { ...empty, error: "Не удалось прочитать файл. Поддерживаются CSV, TSV и XLSX." };
  }

  if (table.headers.length === 0) {
    return { ...empty, error: "Файл пуст или не похож на таблицу" };
  }

  const mapping = guessMapping(table);
  let aiUsed = false;

  // ИИ зовём, только если эвристика не нашла email или осталось много
  // неопознанных колонок — на типовом файле он не нужен
  const unresolved = mapping.filter((m) => m === "skip").length;
  if (!mapping.includes("email") || unresolved > 1) {
    const ai = await suggestFieldMapping({ headers: table.headers, sampleRows: table.rows.slice(0, 5) });
    const valid: FieldKey[] = ["email", "name", "company", "segment", "skip"];
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
): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Файл не передан" };

  const mapping = formData.getAll("mapping").map(String) as FieldKey[];
  const autoSegment = formData.get("autoSegment") === "on";

  let table: TableData;
  try {
    table = await readTable(file);
  } catch {
    return { error: "Не удалось прочитать файл" };
  }

  const rows = applyMapping(table, mapping);
  if (rows.length === 0) {
    return { error: "Не найдено ни одного контакта с корректным email — проверьте разметку колонок" };
  }

  const limit = await checkContactLimit(user, rows.length);
  if (!limit.ok) return { error: limit.error };

  // автосегментация: размечаем уникальные компании, дальше проставляем по
  // совпадению — на базе в тысячи строк размечать каждую строку нереально
  let segmentByCompany: Record<string, string> = {};
  if (autoSegment) {
    const companies = Array.from(
      new Set(rows.map((r) => r.company).filter((c): c is string => Boolean(c)))
    );
    if (companies.length > 0) {
      segmentByCompany = await suggestSegments({ companies });
    }
  }

  const suppressed = new Set(
    (
      await prisma.suppression.findMany({ where: { userId: user.id }, select: { email: true } })
    ).map((s) => s.email.toLowerCase())
  );

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let created = 0;
  let segmented = 0;

  for (const r of rows) {
    const valid = emailRe.test(r.email);
    const status = suppressed.has(r.email) ? "UNSUBSCRIBED" : valid ? "ACTIVE" : "INVALID";
    // сегмент из файла приоритетнее подсказанного ИИ — явные данные клиента
    // всегда важнее нашей догадки
    const segment = r.segment || (r.company ? segmentByCompany[r.company] : undefined);
    if (!r.segment && segment) segmented++;

    try {
      await prisma.contact.upsert({
        where: { userId_email: { userId: user.id, email: r.email } },
        update: { name: r.name, company: r.company, segment, emailValid: valid, status },
        create: {
          userId: user.id,
          email: r.email,
          name: r.name,
          company: r.company,
          segment,
          emailValid: valid,
          status,
        },
      });
      created++;
    } catch {
      // битые строки пропускаем — из-за одной не роняем весь импорт
    }
  }

  revalidatePath("/app/contacts");
  return {
    ok:
      `Загружено контактов: ${created}` +
      (segmented > 0 ? `. ИИ проставил сегмент у ${segmented}` : ""),
  };
}

export async function clearContacts() {
  const user = await requireUser();
  await prisma.contact.deleteMany({ where: { userId: user.id } });
  revalidatePath("/app/contacts");
}
