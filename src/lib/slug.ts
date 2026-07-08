/**
 * Транслитерация RU→lat и slug для managed-поддоменов (<slug>.smailee.ru) и
 * локальных частей адреса. Поддомен должен быть валидной DNS-меткой:
 * только [a-z0-9-], не начинается/заканчивается дефисом, ≤63 символов.
 */

const RU_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function translit(input: string): string {
  return input
    .toLowerCase()
    .split("")
    .map((ch) => (ch in RU_MAP ? RU_MAP[ch] : ch))
    .join("");
}

/** Приводит строку к валидной DNS-метке. Пустой результат → fallback. */
export function toDnsLabel(input: string, fallback = "client"): string {
  const label = translit(input)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40);
  return label || fallback;
}

/** Локальная часть адреса (до @): [a-z0-9._-], не пустая. */
export function toLocalPart(input: string, fallback = "hello"): string {
  const lp = translit(input)
    .replace(/[^a-z0-9._-]+/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 40);
  return lp || fallback;
}
