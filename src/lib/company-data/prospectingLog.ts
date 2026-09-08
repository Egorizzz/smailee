type ErrorLike = Error & {
  code?: unknown;
  status?: unknown;
  cause?: unknown;
};

export type ProspectingErrorDetails = {
  name: string;
  message: string;
  code?: string;
  status?: number;
  cause?: string;
  stack?: string;
};

type ProspectingLogLevel = "info" | "warn" | "error";
type ProspectingLogFields = Record<string, boolean | number | string | null | undefined | Record<string, number>>;

const SECRET_ENV_KEYS = [
  "DATANEWTON_API_KEY",
  "CHECKO_API_KEY",
  "HUNTER_API_KEY",
  "REOON_API_KEY",
  "FIRECRAWL_API_KEY",
  "DEEPSEEK_API_KEY",
] as const;

/**
 * One-line structured logs for Amvera. Search by `prospecting`, an event name,
 * or a run id. User queries, contact emails and provider payloads are omitted.
 */
export function logProspecting(level: ProspectingLogLevel, event: string, fields: ProspectingLogFields = {}) {
  const payload = JSON.stringify({ scope: "prospecting", event, ...defined(fields) });
  if (level === "error") console.error(`[prospecting] ${payload}`);
  else if (level === "warn") console.warn(`[prospecting] ${payload}`);
  else console.log(`[prospecting] ${payload}`);
}

export function prospectingErrorDetails(error: unknown): ProspectingErrorDetails {
  if (!(error instanceof Error)) return { name: "UnknownError", message: sanitize(String(error)) };
  const source = error as ErrorLike;
  const code = primitiveString(source.code);
  const status = typeof source.status === "number" && Number.isFinite(source.status) ? source.status : undefined;
  const cause = source.cause === undefined ? undefined : sanitize(errorMessage(source.cause), 500);
  const stack = source.stack
    ? sanitize(source.stack.split("\n").slice(0, 7).join("\n"), 2_000)
    : undefined;
  return {
    name: sanitize(source.name || "Error", 100),
    message: sanitize(source.message || String(source)),
    ...(code ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(cause ? { cause } : {}),
    ...(stack ? { stack } : {}),
  };
}

export function prospectingErrorMessage(error: unknown) {
  return prospectingErrorDetails(error).message;
}

function sanitize(value: string, maxLength = 1_000) {
  let safe = value;
  for (const key of SECRET_ENV_KEYS) {
    const secret = process.env[key];
    if (secret && secret.length >= 6) safe = safe.split(secret).join("[redacted]");
  }
  safe = safe
    .replace(/([?&](?:key|api_key|token|access_token|authorization)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer [redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]");
  return safe.slice(0, maxLength);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function primitiveString(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return sanitize(String(value), 100);
}

function defined(fields: ProspectingLogFields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
