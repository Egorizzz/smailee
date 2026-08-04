/**
 * Текстовое письмо → минимальная HTML-версия для multipart/alternative.
 *
 * Зачем. Пиксель открытия работает только в HTML. Раньше
 * письмо уходило либо как HTML, либо как чистый text/plain — и режим «Просто
 * текст» (а это большинство холодных писем) не отслеживался вообще: ни
 * открытий, ни кликов.
 *
 * Решение стандартное для рассылок: отправлять обе версии в одном письме.
 * Текстовая остаётся чистой, HTML-версия визуально повторяет её (тот же текст,
 * без оформления), но несёт только пиксель открытия. Клиент показывает HTML,
 * текстовая версия — запасная для тех, кто HTML не принимает.
 *
 * Разметка намеренно бедная: никаких карточек и кнопок. Холодное письмо должно
 * выглядеть как личное сообщение, а не как рассылка — в этом смысл режима.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function plainTextToHtml(text: string): string {
  const html = escapeHtml(text).replace(/\n/g, "<br>");

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#222222;">${html}</div>`;
}
