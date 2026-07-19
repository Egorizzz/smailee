/**
 * Фирменный HTML-каркас письма («Оформление» в мастере кампании).
 *
 * Письмо уходит ОТ ИМЕНИ КЛИЕНТА, поэтому нашего бренда в нём быть не должно:
 * если клиент ничего не настроил, каркас рендерится НЕЙТРАЛЬНО (серая шапка,
 * системный шрифт), а не в цветах Smailee. Раньше дефолтом стоял наш
 * изумрудный — чужие рассылки уходили в фирменных цветах сервиса.
 *
 * Исключение — бесплатный тариф: там внизу обязательная плашка «Отправлено с
 * помощью сервиса рассылок Smailee» (плата за бесплатность, снимается платным
 * тарифом). Это единственное место, где мы упоминаем себя в письме клиента.
 *
 * Чистый строковый модуль без серверных API — используется и на сервере
 * (отправка), и на клиенте (живой предпросмотр в мастере).
 *
 * Вёрстка на таблицах + inline-стили — требование почтовых клиентов
 * (как в src/lib/emailPresets.ts).
 */

export type Brand = {
  color?: string | null; // hex, напр. "#0e9f7e"
  logoUrl?: string | null;
  companyName?: string | null;
  /** Семейство шрифта письма. Пусто — системный стек. */
  font?: string | null;
  /** Подпись в конце письма: имя, должность, контакты. Многострочная. */
  signature?: string | null;
  /**
   * Показать плашку «Отправлено с помощью Smailee». Включается для бесплатного
   * тарифа вызывающей стороной (см. brandForUser), сюда приходит уже решённым.
   */
  poweredBy?: boolean;
};

// Нейтральный тёмно-серый, НЕ фирменный цвет Smailee: дефолт не должен
// выглядеть как чей-то конкретный бренд.
const NEUTRAL_HEADER = "#334155";
const INK = "#334155";
const MUTED = "#64748b";
const LINE = "#e6e9ef";
const SYSTEM_FONT = "-apple-system,Segoe UI,Roboto,Arial,sans-serif";

/**
 * Плашка бесплатного тарифа. Вынесена константой, потому что проставляется в
 * двух местах (каркас здесь и движок отправки для писем без каркаса) и по ней
 * же проверяется, не добавлена ли она уже — расхождение текстов сломало бы
 * проверку и дало дубль в письме.
 */
export const POWERED_BY_TEXT = "Отправлено с помощью сервиса рассылок Smailee.";

/** Белый список шрифтов: в письмо идёт CSS-значение, подставлять произвольный ввод нельзя. */
const SAFE_FONTS: Record<string, string> = {
  system: SYSTEM_FONT,
  arial: "Arial,Helvetica,sans-serif",
  georgia: "Georgia,'Times New Roman',serif",
  times: "'Times New Roman',Times,serif",
  verdana: "Verdana,Geneva,sans-serif",
  tahoma: "Tahoma,Geneva,sans-serif",
  courier: "'Courier New',Courier,monospace",
};

export const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "system", label: "Системный (по умолчанию)" },
  { value: "arial", label: "Arial" },
  { value: "georgia", label: "Georgia" },
  { value: "times", label: "Times New Roman" },
  { value: "verdana", label: "Verdana" },
  { value: "tahoma", label: "Tahoma" },
  { value: "courier", label: "Courier New" },
];

export function fontStack(key?: string | null): string {
  return SAFE_FONTS[key ?? "system"] ?? SYSTEM_FONT;
}

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

/** Оборачивает текст письма в фирменный каркас клиента (шапка, подпись, футер). */
export function wrapInBrandShell(text: string, brand: Brand = {}): string {
  const color = brand.color || NEUTRAL_HEADER;
  const font = fontStack(brand.font);

  // шапка: логотип, если загружен; иначе название компании; иначе — без шапки
  // вовсе (пустая цветная полоса выглядит как ошибка вёрстки)
  const headerInner = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.companyName ?? "")}" style="max-height:36px;max-width:220px;display:block;">`
    : brand.companyName
      ? `<span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.02em;">${esc(brand.companyName)}</span>`
      : "";
  const header = headerInner
    ? `<tr><td style="background:${color};padding:18px 28px;">${headerInner}</td></tr>`
    : "";

  const signature = brand.signature
    ? `<tr><td style="padding:0 28px 24px;color:${INK};font-size:14px;line-height:1.6;">
<div style="border-top:1px solid ${LINE};padding-top:14px;">${esc(brand.signature).replace(/\n/g, "<br>")}</div>
</td></tr>`
    : "";

  const poweredBy = brand.poweredBy
    ? `<div style="margin-top:8px;">${POWERED_BY_TEXT}</div>`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${LINE};font-family:${font};">
${header}
<tr><td style="padding:28px;color:${INK};font-size:15px;line-height:1.65;">
${textToHtmlParagraphs(text)}
</td></tr>
${signature}
<tr><td style="padding:20px 28px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:1.6;">
Вы получили это письмо, потому что ваш контакт есть в открытых источниках.
<a href="{{unsubscribe_url}}" style="color:${MUTED};text-decoration:underline;">Отписаться</a>.${poweredBy}
</td></tr>
</table>
</td></tr></table></body></html>`;
}

/**
 * Собирает Brand из профиля пользователя. Одно место, где решается вопрос
 * «показывать ли плашку Smailee» — чтобы отправка и предпросмотр не разъехались
 * (предпросмотр без плашки, а клиент получает с плашкой — худший вариант).
 */
export function brandForUser(user: {
  brandColor?: string | null;
  brandLogoUrl?: string | null;
  brandFont?: string | null;
  brandSignature?: string | null;
  companyName?: string | null;
  plan?: string | null;
}): Brand {
  return {
    color: user.brandColor,
    logoUrl: user.brandLogoUrl,
    companyName: user.companyName,
    font: user.brandFont,
    signature: user.brandSignature,
    poweredBy: (user.plan ?? "TRIAL") === "TRIAL",
  };
}
