import okveds from "@/data/okved2.json";

export type OkvedCatalogCode = {
  id: string;
  kind: "code";
  code: string;
  description: string;
  section: string;
  sectionDescription: string;
  hasChildren: boolean;
};

export type OkvedCatalogSection = {
  id: string;
  kind: "section";
  section: string;
  description: string;
  hasChildren: boolean;
};

export type OkvedCatalogNode = OkvedCatalogCode | OkvedCatalogSection;

export const OKVED_SECTION_DESCRIPTIONS: Record<string, string> = {
  A: "Сельское, лесное хозяйство, охота, рыболовство и рыбоводство",
  B: "Добыча полезных ископаемых",
  C: "Обрабатывающие производства",
  D: "Обеспечение электрической энергией, газом и паром; кондиционирование воздуха",
  E: "Водоснабжение, водоотведение, сбор и утилизация отходов, ликвидация загрязнений",
  F: "Строительство",
  G: "Торговля оптовая и розничная; ремонт автотранспортных средств и мотоциклов",
  H: "Транспортировка и хранение",
  I: "Деятельность гостиниц и предприятий общественного питания",
  J: "Деятельность в области информации и связи",
  K: "Деятельность финансовая и страховая",
  L: "Деятельность по операциям с недвижимым имуществом",
  M: "Деятельность профессиональная, научная и техническая",
  N: "Деятельность административная и сопутствующие дополнительные услуги",
  O: "Государственное управление и обеспечение военной безопасности; социальное обеспечение",
  P: "Образование",
  Q: "Деятельность в области здравоохранения и социальных услуг",
  R: "Деятельность в области культуры, спорта, организации досуга и развлечений",
  S: "Предоставление прочих видов услуг",
  T: "Деятельность домашних хозяйств",
  U: "Деятельность экстерриториальных организаций и органов",
};

type SourceItem = (typeof okveds)[number];

export function okvedRootSections(): OkvedCatalogSection[] {
  return Object.entries(OKVED_SECTION_DESCRIPTIONS).map(([section, description]) => ({
    id: `section:${section}`,
    kind: "section",
    section,
    description,
    hasChildren: okveds.some((item) => item.section === section),
  }));
}

export function okvedChildren(parent: string): OkvedCatalogCode[] {
  if (parent.startsWith("section:")) {
    const section = parent.slice("section:".length).toUpperCase();
    const inSection = okveds.filter((item) => item.section === section);
    const minimumDepth = Math.min(...inSection.map((item) => okvedDepth(item.code)));
    return inSection.filter((item) => okvedDepth(item.code) === minimumDepth).map(toCatalogCode);
  }

  const parentDepth = okvedDepth(parent);
  const descendants = okveds.filter((item) => isOkvedDescendant(item.code, parent));
  if (!descendants.length) return [];
  const childDepth = Math.min(...descendants.map((item) => okvedDepth(item.code)).filter((depth) => depth > parentDepth));
  return descendants.filter((item) => okvedDepth(item.code) === childDepth).map(toCatalogCode);
}

export function searchOkvedCatalog(query: string, limit = 80): OkvedCatalogCode[] {
  const normalizedQuery = normalize(query);
  const tokenGroups = normalizedQuery.split(/\s+/).filter((token) => token && !STOP_WORDS.has(tokenStem(token))).map(searchVariants);
  return okveds
    .filter((item) => {
      if (!tokenGroups.length) return false;
      const description = normalize(item.description);
      const words = description.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      return tokenGroups.every((variants) => variants.some((token) => item.code.startsWith(token) || words.some((word) => word.startsWith(token))));
    })
    .sort((a, b) => scoreOkved(b, normalizedQuery) - scoreOkved(a, normalizedQuery) || a.code.localeCompare(b.code, "ru"))
    .slice(0, limit)
    .map(toCatalogCode);
}

export function okvedCatalogSize() {
  return okveds.length;
}

export function okvedByCode(code: string): OkvedCatalogCode | undefined {
  const item = okveds.find((candidate) => candidate.code === code.trim());
  return item ? toCatalogCode(item) : undefined;
}

export function normalizeSuggestedOkveds(items: Array<{ code: string; description?: string }>, limit = 8) {
  const valid = items.flatMap((item) => {
    const catalogItem = okvedByCode(item.code);
    return catalogItem ? [{ code: catalogItem.code, description: catalogItem.description }] : [];
  });
  const unique = [...new Map(valid.map((item) => [item.code, item])).values()];
  return unique
    .filter((item) => !unique.some((candidate) => candidate.code !== item.code && isOkvedDescendant(candidate.code, item.code)))
    .sort((a, b) => b.code.replace(/\D/g, "").length - a.code.replace(/\D/g, "").length || a.code.localeCompare(b.code, "ru"))
    .slice(0, limit);
}

function toCatalogCode(item: SourceItem): OkvedCatalogCode {
  return {
    id: `code:${item.code}`,
    kind: "code",
    code: item.code,
    description: item.description,
    section: item.section,
    sectionDescription: OKVED_SECTION_DESCRIPTIONS[item.section] ?? "",
    hasChildren: okveds.some((candidate) => isOkvedDescendant(candidate.code, item.code)),
  };
}

function okvedDepth(code: string) {
  return code.replace(/\D/g, "").length;
}

function isOkvedDescendant(code: string, parent: string) {
  const codeDigits = code.replace(/\D/g, "");
  const parentDigits = parent.replace(/\D/g, "");
  return code !== parent && codeDigits.startsWith(parentDigits) && codeDigits.length > parentDigits.length;
}

const SYNONYMS: Record<string, string[]> = {
  юрид: ["прав", "юстиц"], юрист: ["прав", "юстиц"],
  айти: ["информацион", "программ", "вычисл"], it: ["информацион", "программ", "вычисл"],
  маркет: ["реклам", "рынк"], логист: ["перевоз", "транспорт", "склад"],
  кафе: ["питан", "ресторан"], недвиж: ["недвиж"], консалт: ["консульт"],
};
const STOP_WORDS = new Set(["услу", "деят", "комп", "орга", "бизн", "рабо"]);

function normalize(value: string) { return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е"); }
function tokenStem(token: string) { return token.length > 4 ? token.slice(0, 4) : token; }
function searchVariants(token: string) {
  if (/^\d/.test(token)) return [token];
  const stem = tokenStem(token);
  const synonyms = Object.entries(SYNONYMS).find(([key]) => token.startsWith(key) || key.startsWith(token))?.[1] ?? [];
  return [...new Set([stem, ...synonyms])];
}

function scoreOkved(item: SourceItem, query: string) {
  if (item.code === query) return 100;
  if (item.code.startsWith(query)) return 80;
  if (normalize(item.description).startsWith(query)) return 60;
  return 10 - okvedDepth(item.code);
}
