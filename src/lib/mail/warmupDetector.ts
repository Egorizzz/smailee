/**
 * Детект прогревочных писем (ТЗ §5.6, §5.4): «новое письмо → определить —
 * прогревочное (по скрытому коду → в WarmupEvent, скрыть) или реальный ответ».
 *
 * Маркер (§5.6) — НЕ заголовок (не X-Warmup): невидимый span в HTML-теле
 * письма, который переживает реальный SMTP/IMAP round-trip:
 *   <span style="display:none">sw:{code}</span>
 * Прогревочные письма всегда отправляются как HTML (см. warmupEngine.ts),
 * поэтому маркер ищем в html; text — фолбэк на случай почтового клиента,
 * разобравшего письмо иначе.
 */

const MARKER_RE = /<span style="display:none">sw:([a-zA-Z0-9_-]+)<\/span>/i;
const MARKER_TEXT_RE = /\[sw:([a-zA-Z0-9_-]+)\]/i;

export type InboundEmailForWarmupCheck = {
  subject: string;
  text?: string | null;
  html?: string | null;
};

/** Оборачивает код в невидимый span для вставки в HTML-тело прогревочного письма. */
export function embedWarmupMarker(code: string): string {
  return `<span style="display:none">sw:${code}</span>`;
}

/**
 * code, если письмо признано частью сети прогрева (в M3-поллинге по нему не
 * создаётся диалог/лид/AI-ответ), иначе null.
 */
export function extractWarmupCode(email: InboundEmailForWarmupCheck): string | null {
  if (email.html) {
    const m = MARKER_RE.exec(email.html);
    if (m) return m[1];
  }
  if (email.text) {
    const m = MARKER_TEXT_RE.exec(email.text);
    if (m) return m[1];
  }
  return null;
}
