import { ZodError } from "zod";

export type PublicProductError = { error: string; code: string; retryable?: boolean };

export class ProductError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly retryable = false,
    readonly diagnostic?: unknown,
  ) { super(message); }
}

export const ERROR_CODES = {
  invalidInput: "CNT-1001",
  quotaExceeded: "CNT-1002",
  importRead: "CNT-1101",
  importPartial: "CNT-1102",
  verification: "CNT-1201",
  siteAnalysis: "CNT-1301",
  contactNotFound: "CNT-1404",
  prospecting: "SRC-2001",
  sourceExhausted: "SRC-2002",
  prospectingStatus: "SRC-2003",
  providerUnavailable: "SRC-2101",
  aiUnavailable: "AI-3001",
  unexpected: "SYS-9001",
} as const;

export function publicProductError(error: unknown, fallback: string = ERROR_CODES.unexpected): PublicProductError & { status: number } {
  if (error instanceof ProductError) return { error: error.message, code: error.code, retryable: error.retryable, status: error.status };
  if (error instanceof ZodError) return { error: "Проверьте заполненные поля и попробуйте снова.", code: ERROR_CODES.invalidInput, status: 400 };
  console.error(`[${fallback}]`, error);
  return { error: "Не удалось завершить действие. Повторите попытку или сообщите код поддержке.", code: fallback, retryable: true, status: 500 };
}

export function productErrorResponse(error: unknown, fallback?: string) {
  const normalized = publicProductError(error, fallback);
  return Response.json({ error: normalized.error, code: normalized.code, retryable: normalized.retryable }, { status: normalized.status });
}

export function clientErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const value = body as { error?: unknown; code?: unknown };
  const message = typeof value.error === "string" ? value.error : fallback;
  return typeof value.code === "string" ? `${message} Код: ${value.code}` : message;
}
