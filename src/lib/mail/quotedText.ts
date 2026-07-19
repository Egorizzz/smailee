/**
 * Разбор тела входящего письма для показа в треде.
 *
 * Почтовые клиенты подклеивают к ответу всю предыдущую переписку плюс
 * служебную обвязку. В карточке диалога это выглядит как «простыня»: сначала
 * одна строка ответа, потом экран цитат, подписей и наш же футер с отпиской.
 * Здесь письмо режется на то, что человек реально написал, и всё остальное —
 * второе прячется за кнопку «Показать предыдущую переписку».
 *
 * Чистые функции без внешних зависимостей — покрыты smoke-тестами.
 */

/** Грубая, но достаточная проверка «это HTML, а не текст». */
export function looksLikeHtml(s: string): boolean {
  return /<(?:html|body|div|p|br|table|span|a|img)\b[^>]*>/i.test(s);
}

/**
 * HTML → читаемый текст. Не полноценный парсер: задача не отрендерить письмо,
 * а показать оператору суть без тегов и стилей. Порядок важен — сначала
 * вырезаем невидимое содержимое (script/style/head), иначе CSS утечёт в текст.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Маркеры начала цитаты. Порядок не важен — ищем самое РАННЕЕ вхождение:
 * всё, что после первого маркера, уже цитата, даже если ниже встретится другой.
 */
const QUOTE_MARKERS: RegExp[] = [
  // Яндекс/Mail.ru: «19.07.2026, 12:00, Иван <i@x.ru> пишет:»
  /^\s*\d{1,2}[.,]\d{2}[.,]\d{2,4}.*(?:пишет|написал\(а\)|написал)\s*:\s*$/im,
  // Gmail/англ.: «On Mon, Jul 19, 2026 at 12:00, Ivan <i@x.ru> wrote:»
  /^\s*On .+ wrote:\s*$/im,
  // Outlook
  /^\s*-{2,}\s*(?:Original Message|Исходное сообщение)\s*-{2,}\s*$/im,
  /^\s*(?:From|От кого|Отправитель)\s*:\s*.+$/im,
  // разделитель Outlook — длинная линия подчёркиваний
  /^\s*_{10,}\s*$/im,
  // наш собственный футер отписки, прилетевший обратно в цитате
  /^\s*—\s*\n?\s*Отписаться от рассылки\s*:/im,
];

export type ParsedReply = {
  /** То, что человек написал сам. */
  visible: string;
  /** Цитата предыдущей переписки и служебный хвост. Пусто, если их нет. */
  quoted: string;
};

/**
 * Делит тело письма на «свежий ответ» и «предыдущую переписку».
 * HTML-письма сначала приводятся к тексту: без этого в тред попадали теги и
 * стили — та самая нечитаемая «системная» простыня.
 */
export function parseReplyBody(raw: string): ParsedReply {
  const text = looksLikeHtml(raw) ? htmlToText(raw) : raw;

  let cutAt = -1;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index >= 0 && (cutAt === -1 || m.index < cutAt)) cutAt = m.index;
  }

  // Сплошной блок строк с «>» в начале тоже считается цитатой, даже без
  // текстового маркера перед ним (некоторые клиенты его не ставят).
  const lines = text.split("\n");
  const firstQuoteLine = lines.findIndex((l) => /^\s*>/.test(l));
  if (firstQuoteLine >= 0) {
    const idx = lines.slice(0, firstQuoteLine).join("\n").length;
    if (cutAt === -1 || idx < cutAt) cutAt = idx;
  }

  if (cutAt === -1) return { visible: text.trim(), quoted: "" };

  const visible = text.slice(0, cutAt).trim();
  const quoted = text.slice(cutAt).trim();

  // Если «свежая» часть пустая — значит маркер сработал на первой строке и
  // резать нечего: показываем письмо целиком, иначе оператор увидит пустоту.
  if (!visible) return { visible: text.trim(), quoted: "" };

  return { visible, quoted };
}
