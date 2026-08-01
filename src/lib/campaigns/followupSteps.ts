/**
 * Цепочка follow-up писем (§5.3, по базе знаний Trigga: «Составлена ли
 * цепочка» — 3-4 письма с интервалом 2-3 рабочих дня даёт заметно больше
 * ответов, чем одно). Мастер присылает цепочку одним JSON-полем формы —
 * массив шагов по порядку [{daysAfterPrevious, subject, body}, ...],
 * stepNumber присваивается по позиции в массиве (1, 2, 3…), в самих данных
 * его нет.
 *
 * Живёт отдельным модулем по той же причине, что и segmentTexts.ts: из
 * файла с "use server" можно экспортировать только async-функции, а эту
 * нужно звать синхронно и покрыть тестами.
 */

export type FollowupStepInput = { daysAfterPrevious: number; subject: string; body: string };

/** Разумный потолок длины цепочки — Trigga рекомендует 3-4, берём с запасом. */
export const MAX_FOLLOWUP_STEPS = 6;

/**
 * Разбор поля формы. Данные приходят из браузера, поэтому проверяется каждая
 * запись: битый JSON, чужая структура или подложенный мусор не должны ронять
 * создание кампании — в таком случае молча возвращаем пустую цепочку (follow-up
 * просто не создаётся, а не падает вся кампания).
 *
 * Проверяется по-настоящему, не только форма: daysAfterPrevious — целое число
 * от 1 до 30 (те же границы, что раньше были у followupDays), subject/body —
 * непустые строки после обрезки пробелов. Битый элемент отбрасывается
 * поштучно и НЕ смещает номера шагов у соседей: если элемент 2 из 3 сломан,
 * получится цепочка [1, 2] по позициям 1 и 2 в массиве, а не дыра на месте
 * второго шага — designed так же, как sanitizeEmailVariants.
 */
export function parseFollowupSteps(raw: string): FollowupStepInput[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: FollowupStepInput[] = [];
  for (const item of parsed.slice(0, MAX_FOLLOWUP_STEPS)) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const days = Number(t.daysAfterPrevious);
    const subject = typeof t.subject === "string" ? t.subject.trim() : "";
    const body = typeof t.body === "string" ? t.body.trim() : "";
    if (Number.isInteger(days) && days >= 1 && days <= 30 && subject && body) {
      out.push({ daysAfterPrevious: days, subject, body });
    }
  }
  return out;
}
