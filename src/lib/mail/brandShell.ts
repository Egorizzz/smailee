/**
 * Фирменный HTML-каркас письма (R3, «Оформление» в мастере кампании).
 *
 * Один бренд-цвет (шапка/кнопки/акценты) + логотип (URL) или название
 * компании в шапке. Чистый строковый модуль без серверных API — используется
 * и на сервере (отправка), и на клиенте (живой предпросмотр в мастере).
 *
 * Вёрстка на таблицах + inline-стили — требование почтовых клиентов
 * (как в src/lib/emailPresets.ts).
 */

export type Brand = {
  color?: string | null; // hex, напр. "#0e9f7e"
  logoUrl?: string | null;
  companyName?: string | null;
};

const DEFAULT_COLOR = "#22a88d";
const INK = "#334155";
const MUTED = "#64748b";
const LINE = "#e6e9ef";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Плейн-текст → HTML-параграфы (пустая строка = новый абзац). Переменные {{…}} сохраняются. */
export function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Оборачивает текст письма в фирменный каркас: шапка (лого/название на бренд-цвете) + футер с отпиской. */
export function wrapInBrandShell(text: string, brand: Brand = {}): string {
  const color = brand.color || DEFAULT_COLOR;
  const header = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.companyName ?? "")}" style="max-height:32px;max-width:220px;display:block;">`
    : `<span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.02em;">${esc(brand.companyName || "Ваша компания")}</span>`;

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${LINE};font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
<tr><td style="background:${color};padding:18px 28px;">${header}</td></tr>
<tr><td style="padding:28px;color:${INK};font-size:15px;line-height:1.65;">
${textToHtmlParagraphs(text)}
</td></tr>
<tr><td style="padding:20px 28px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:1.6;">
Вы получили это письмо, потому что ваш контакт есть в открытых источниках.
<a href="{{unsubscribe_url}}" style="color:${MUTED};text-decoration:underline;">Отписаться</a>.
</td></tr>
</table>
</td></tr></table></body></html>`;
}
