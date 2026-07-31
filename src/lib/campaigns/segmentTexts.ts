/**
 * Тексты писем по сегментам для мультисегментной кампании.
 *
 * Мастер создаёт по кампании на каждый выбранный сегмент и присылает их тексты
 * одним полем формы: JSON вида { "<сегмент>": { subject, body } }. Раньше во
 * все кампании пачки уходил ОДИН текст, сгенерированный под первый сегмент, —
 * то есть разделение по сегментам было только в статистике, а письма у всех
 * одинаковые. У сегментов разные боли и лексика, ради этого их и разделяют.
 *
 * Живёт отдельным модулем, а не рядом с server action: из файла с "use server"
 * можно экспортировать только async-функции, а эту нужно звать синхронно и
 * покрыть тестами.
 */

export type SegmentText = { subject: string; body: string };

/**
 * Разбор поля формы. Данные приходят из браузера, поэтому проверяется каждая
 * запись: битый JSON, чужая структура или подложенный мусор не должны ронять
 * создание кампании — в таком случае молча откатываемся на общий текст.
 */
export function parseSegmentTexts(raw: string): Record<string, SegmentText> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const out: Record<string, SegmentText> = {};
  for (const [segment, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!segment) continue;
    const t = value as { subject?: unknown; body?: unknown } | null;
    if (typeof t?.subject === "string" && typeof t?.body === "string") {
      out[segment] = { subject: t.subject, body: t.body };
    }
  }
  return out;
}
