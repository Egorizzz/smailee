import { normalizePlaceholders } from "@/lib/mail/placeholders";

/**
 * Разбор и очистка ответа ИИ на запрос вариантов холодного письма.
 *
 * Зачем отдельным модулем. Оба адаптера (deepseek.ts, claude.ts) просто
 * делали `if (Array.isArray(parsed)) return parsed;` — то есть доверяли
 * модели вернуть строго {subject, body}[] без единой проверки. Реальный
 * случай (2026-08-01): модель вернула 2 объекта, но с ЛИШНИМ полем
 * `body_alt` — похоже, спутала «сгенерируй N вариантов» с «вариант плюс
 * альтернативная формулировка внутри». Лишнее поле молча долетало до конца
 * и терялось — то есть половина оплаченной генерации выбрасывалась без
 * следа, а мы об этом даже не узнавали. Хуже: если бы модель ОШИБЛАСЬ в
 * обязательном поле (забыла body, дала число вместо строки), это дошло бы
 * до мастера кампании и уронило бы его на `.replace()` от не-строки.
 *
 * Тот же принцип, что и в src/lib/mail/placeholders.ts: промпт просит
 * модель вести себя правильно, а код это ПРОВЕРЯЕТ — доверять формату
 * ответа LLM нельзя, только валидировать после факта.
 */

export type EmailVariant = { subject: string; body: string };
export type PersonalizedEmail = EmailVariant & { usedContextIds: string[] };

const FORBIDDEN_DIRECT_VARIABLE = /\{\{(?:name|company)\}\}/;

export function enforceSafeRecipientPersonalization(variant: EmailVariant): EmailVariant {
  let body = normalizePlaceholders(variant.body)
    .replace(/^(?:Здравствуйте|Добрый день|Привет)\s*,?\s*\{\{name\}\}\s*[!.]?\s*/i, "{{greeting}}\n\n")
    .split("\n")
    .filter((line) => !FORBIDDEN_DIRECT_VARIABLE.test(line))
    .join("\n")
    .trim();
  if (!body.includes("{{greeting}}")) body = `{{greeting}}\n\n${body}`;
  if (!body.includes("{{company_observation}}")) {
    body = body.replace("{{greeting}}", "{{greeting}}\n\n{{company_observation}}");
  }
  body = body.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n");
  const normalizedSubject = normalizePlaceholders(variant.subject);
  const subject = FORBIDDEN_DIRECT_VARIABLE.test(normalizedSubject) ? "Короткий вопрос" : normalizedSubject;
  return { subject, body };
}

/**
 * Оставляет только валидные элементы: subject и body — непустые строки.
 * Лишние поля (body_alt и подобное) отбрасываются молча — контракт с
 * остальным кодом ({subject, body}) должен выполняться буквально, а не
 * "примерно". Некорректные элементы пропускаются поштучно, а не рушат
 * весь ответ — если из трёх вариантов один сломан, лучше вернуть два
 * рабочих, чем ничего.
 */
export function sanitizeEmailVariants(parsed: unknown): EmailVariant[] {
  if (!Array.isArray(parsed)) return [];
  const out: EmailVariant[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const subject = (item as Record<string, unknown>).subject;
    const body = (item as Record<string, unknown>).body;
    if (typeof subject === "string" && subject.trim() && typeof body === "string" && body.trim()) {
      const safe = enforceSafeRecipientPersonalization({ subject: subject.trim(), body: body.trim() });
      const substantiveBody = safe.body.replace(/\{\{(?:greeting|company_observation)\}\}/g, "").trim();
      if (substantiveBody.length >= 4) out.push(safe);
    }
  }
  return out;
}

/** A per-recipient result is final copy: placeholders and spintax are forbidden. */
export function sanitizePersonalizedEmail(parsed: unknown, allowedContextIds: string[]): PersonalizedEmail | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (typeof value.subject !== "string" || typeof value.body !== "string") return null;
  const subject = value.subject.trim().slice(0, 240);
  const body = value.body.trim().slice(0, 6_000);
  const normalized = normalizePlaceholders(`${subject}\n${body}`);
  if (!subject || body.length < 40 || /[{}\[\]]/.test(normalized)) return null;
  const allowed = new Set(allowedContextIds);
  const usedContextIds = Array.isArray(value.usedContextIds)
    ? [...new Set(value.usedContextIds.filter((id): id is string => typeof id === "string" && allowed.has(id)))].slice(0, 8)
    : [];
  return { subject, body, usedContextIds };
}
