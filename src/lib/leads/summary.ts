function stripJsonFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\n/g, " ").replace(/\\"/g, '"');
  }
}

/**
 * Keeps model transport details out of product copy. Besides ordinary summary
 * strings, this understands fenced/full JSON accidentally persisted by older
 * qualification runs and can recover the summary from a truncated payload.
 */
export function normalizeLeadSummary(value: unknown) {
  if (typeof value !== "string") return "";
  const original = value.trim();
  if (!original) return "";

  const candidate = stripJsonFence(original);
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
      if (typeof parsed.summary === "string" && parsed.summary.trim()) return parsed.summary.trim();
    } catch {
      // A cut-off provider response may still contain a complete summary field.
    }
  }

  const summaryMatch = candidate.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  if (summaryMatch?.[1]) return decodeJsonString(summaryMatch[1]).trim();

  if (/^```/i.test(original) || candidate.startsWith("{") || /"qualification"\s*:/i.test(candidate)) return "";

  return original;
}
