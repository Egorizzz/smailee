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
      out.push({ subject: subject.trim(), body: body.trim() });
    }
  }
  return out;
}
