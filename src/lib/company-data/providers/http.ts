import type { CompanyFields, JsonValue } from "../types";

export type FetchLike = typeof fetch;

export async function fetchJson(
  fetcher: FetchLike,
  provider: string,
  url: URL,
  init?: RequestInit,
): Promise<Record<string, JsonValue>> {
  const response = await fetcher(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) });
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    const message = isRecord(body) ? body.message ?? body.error ?? `HTTP ${response.status}` : `HTTP ${response.status}`;
    throw new Error(`${provider}: ${String(message)}`);
  }
  if (!isRecord(body)) throw new Error(`${provider}: API returned a non-object response`);
  return body as Record<string, JsonValue>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function firstArray(body: Record<string, unknown>, keys = ["data", "items", "results", "companies"]): unknown[] {
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) return value;
    if (isRecord(value)) {
      for (const nested of keys) if (Array.isArray(value[nested])) return value[nested] as unknown[];
    }
  }
  return [];
}

export function textAt(value: unknown, ...paths: string[]): string | undefined {
  for (const path of paths) {
    let current: unknown = value;
    for (const part of path.split(".")) current = isRecord(current) ? current[part] : undefined;
    if (typeof current === "string" && current.trim()) return current.trim();
    if (typeof current === "number") return String(current);
  }
}

export function stringsAt(value: unknown, ...paths: string[]): string[] {
  for (const path of paths) {
    let current: unknown = value;
    for (const part of path.split(".")) current = isRecord(current) ? current[part] : undefined;
    if (Array.isArray(current)) return current.filter((item): item is string => typeof item === "string");
    if (typeof current === "string" && current.trim()) return [current.trim()];
  }
  return [];
}

export function namespaceFields(prefix: string, value: Record<string, unknown>): CompanyFields {
  const fields: CompanyFields = {};
  for (const [key, item] of Object.entries(value)) {
    if (isJsonValue(item)) fields[`${prefix}.${key}`] = item;
  }
  return fields;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
