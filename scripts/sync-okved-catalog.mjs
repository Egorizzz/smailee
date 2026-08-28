import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE = "https://raw.githubusercontent.com/prog815/okved2/main/data.js";
const response = await fetch(SOURCE, { headers: { "user-agent": "smailee-okved-sync" } });
if (!response.ok) throw new Error(`Не удалось скачать ОКВЭД: ${response.status}`);

const source = await response.text();
const start = source.indexOf("[");
const end = source.lastIndexOf("]");
if (start < 0 || end <= start) throw new Error("Источник ОКВЭД вернул неожиданный формат");

const rows = JSON.parse(source.slice(start, end + 1))
  .filter((row) => row && typeof row.code === "string" && typeof row.name === "string")
  .map((row) => ({ code: row.code.trim(), description: row.name.trim(), section: row.section ?? null }))
  .filter((row) => /^\d{2}(?:\.\d{1,2}){0,2}$/.test(row.code) && row.description);

const target = path.join(process.cwd(), "src", "data", "okved2.json");
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(rows)}\n`, "utf8");
console.log(`Сохранено ${rows.length} кодов ОКВЭД в ${target}`);
