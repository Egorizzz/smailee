import type { Prisma } from "@prisma/client";
import type { CompanyFilter, FieldFilter, JsonValue } from "./types";

const CORE = new Set(["countryCode", "inn", "ogrn", "legalName", "displayName", "website", "domain", "status"]);

export function compileCompanyFilter(filter?: CompanyFilter): Prisma.CompanyWhereInput {
  if (!filter) return {};
  if ("and" in filter) return { AND: filter.and.map(compileCompanyFilter) };
  if ("or" in filter) return { OR: filter.or.map(compileCompanyFilter) };
  if ("not" in filter) return { NOT: compileCompanyFilter(filter.not) };
  if (CORE.has(filter.field)) return coreFilter(filter);
  const arbitrary = arbitraryFilter(filter);
  return filter.operator === "exists" && filter.value === false
    ? { fieldValues: { none: arbitrary } }
    : { fieldValues: { some: arbitrary } };
}

function coreFilter(filter: FieldFilter): Prisma.CompanyWhereInput {
  const field = filter.field as keyof Prisma.CompanyWhereInput;
  const value = filter.value;
  let condition: unknown;
  switch (filter.operator) {
    case "eq": condition = value; break;
    case "neq": condition = { not: value }; break;
    case "in": condition = { in: asArray(value) }; break;
    case "contains": condition = { contains: String(value ?? ""), mode: "insensitive" }; break;
    case "startsWith": condition = { startsWith: String(value ?? ""), mode: "insensitive" }; break;
    case "exists": condition = value === false ? null : { not: null }; break;
    default: throw new Error(`Operator ${filter.operator} is not supported for core text fields`);
  }
  return { [field]: condition } as Prisma.CompanyWhereInput;
}

function arbitraryFilter(filter: FieldFilter): Prisma.CompanyFieldValueWhereInput {
  const base: Prisma.CompanyFieldValueWhereInput = { field: { key: filter.field, filterable: true } };
  const value = filter.value;
  if (filter.operator === "exists") return base;
  if (filter.valueType === "STRING_LIST" && filter.operator === "contains") {
    return { ...base, stringList: { has: String(value ?? "") } };
  }
  if (filter.operator === "contains" || filter.operator === "startsWith") {
    return { ...base, stringValue: { [filter.operator]: String(value ?? ""), mode: "insensitive" } };
  }
  if (["gt", "gte", "lt", "lte"].includes(filter.operator)) {
    if (filter.valueType === "DATE") return { ...base, dateValue: { [filter.operator]: new Date(String(value)) } };
    return { ...base, numberValue: { [filter.operator]: String(value) } };
  }
  if (filter.operator === "between") {
    const [gte, lte] = asArray(value);
    if (filter.valueType === "DATE") return { ...base, dateValue: { gte: new Date(String(gte)), lte: new Date(String(lte)) } };
    return { ...base, numberValue: { gte: String(gte), lte: String(lte) } };
  }
  if (filter.operator === "in") return { ...base, stringValue: { in: asArray(value).map(String) } };
  if (filter.operator === "neq") return { ...base, NOT: { stringValue: scalar(value) } };
  return { ...base, OR: [
    { stringValue: scalar(value) },
    { booleanValue: typeof value === "boolean" ? value : undefined },
    { numberValue: typeof value === "number" ? String(value) : undefined },
    { dateValue: filter.valueType === "DATE" ? new Date(String(value)) : undefined },
  ] };
}

function scalar(value: JsonValue | undefined): string | undefined { return value == null ? undefined : String(value); }
function asArray(value: JsonValue | undefined): JsonValue[] { return Array.isArray(value) ? value : [value ?? null]; }
