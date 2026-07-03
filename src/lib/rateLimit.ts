/**
 * Простой in-memory rate limiter по ключу (IP).
 * Для одного инстанса достаточно; при горизонтальном масштабировании
 * заменить на Redis. Защищает публичные endpoint'ы от спама.
 */

const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  { limit = 5, windowMs = 60_000 }: { limit?: number; windowMs?: number } = {}
): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  if (entry.count > limit) return false;
  return true;
}

// периодическая чистка, чтобы Map не рос бесконечно
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) {
    if (v.resetAt < now) hits.delete(k);
  }
}, 5 * 60_000).unref?.();
