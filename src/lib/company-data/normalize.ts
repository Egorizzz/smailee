import { createHash } from "node:crypto";
import type { CompanyFieldType } from "@prisma/client";
import type { JsonValue, ProviderCompany, TypedFieldValue } from "./types";
import { publicCompanyName } from "./contactPresentation";

const KEY = /^[\p{L}][\p{L}\p{N}_.-]{0,127}$/u;

export function normalizeProviderCompany(sourceKey: string, input: ProviderCompany): ProviderCompany {
  if (!input.externalId.trim()) throw new Error("Provider company externalId is required");
  const fields = Object.fromEntries(Object.entries(input.fields ?? {}).map(([key, value]) => [
    canonicalFieldKey(sourceKey, key), value,
  ]));
  const website = clean(input.website);
  return {
    ...input,
    externalId: input.externalId.trim(),
    identity: {
      countryCode: clean(input.identity?.countryCode)?.toUpperCase() ?? "RU",
      inn: normalizeRussianInn(input.identity?.inn),
      ogrn: digits(input.identity?.ogrn),
      domain: normalizeDomain(input.identity?.domain ?? website),
    },
    legalName: clean(input.legalName),
    displayName: publicCompanyName(input.displayName) ?? undefined,
    website,
    status: clean(input.status),
    fields,
  };
}

/** Российский ИНН юрлица содержит 10 цифр, ИП/физлица — 12. */
export function normalizeRussianInn(value?: string | null): string | undefined {
  const normalized = value?.trim().replace(/\D/g, "") ?? "";
  return /^\d{10}(?:\d{2})?$/.test(normalized) ? normalized : undefined;
}

export function canonicalFieldKey(sourceKey: string, key: string): string {
  const normalized = key.trim().toLowerCase().replace(/[^\p{L}\p{N}_.-]+/gu, "_").replace(/^_+|_+$/g, "");
  if (!normalized) throw new Error("Company field key cannot be empty");
  const canonical = KEY.test(normalized) ? normalized : `${sourceKey}.${normalized}`;
  return canonical.slice(0, 128);
}

export function inferFieldValue(value: JsonValue): TypedFieldValue {
  if (typeof value === "string") return { type: "STRING", stringValue: value, rawValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return { type: "NUMBER", numberValue: String(value), rawValue: value };
  if (typeof value === "boolean") return { type: "BOOLEAN", booleanValue: value, rawValue: value };
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return { type: "STRING_LIST", stringList: value, rawValue: value };
  }
  return { type: "JSON", jsonValue: value, rawValue: value };
}

export function fieldValueOfType(type: CompanyFieldType, value: JsonValue): TypedFieldValue {
  // JSON — универсальный тип поля поставщика: после того как схема расширилась
  // от простого значения до объекта/массива, последующие допустимые JSON-формы
  // не должны останавливать весь импорт.
  if (type === "JSON") return { type, jsonValue: value, rawValue: value };
  if (type === "DATE" && typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return { type, dateValue: date, rawValue: value };
  }
  const inferred = inferFieldValue(value);
  if (inferred.type !== type) throw new Error(`Field value does not match ${type}`);
  return inferred;
}

export function stableChecksum(value: JsonValue): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function clean(value?: string): string | undefined { return value?.trim() || undefined; }
function digits(value?: string): string | undefined { return clean(value)?.replace(/\D/g, "") || undefined; }
function normalizeDomain(value?: string): string | undefined {
  if (!value) return undefined;
  try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return undefined; }
}
