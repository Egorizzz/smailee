export type PublicCompanyFact = {
  key: "inn" | "activity" | "okved" | "region" | "leader" | "employees" | "revenue";
  label: string;
  value: string;
};

const COMPANY_NAME_PLACEHOLDERS = new Set([
  "информация о компании",
  "сведения о компании",
  "о компании",
  "company information",
  "компания",
]);

const SEGMENT_PLACEHOLDERS = new Set(["ai-подборка", "ai подборка", "подборка ai"]);

export function isCompanyNamePlaceholder(value: string | null | undefined) {
  return !value?.trim() || COMPANY_NAME_PLACEHOLDERS.has(value.trim().toLocaleLowerCase("ru-RU"));
}

export function publicCompanyName(value: string | null | undefined) {
  return isCompanyNamePlaceholder(value) ? null : value!.trim();
}

export function publicSegment(value: string | null | undefined, activity?: string | null) {
  const normalized = value?.trim().toLocaleLowerCase("ru-RU") ?? "";
  if (value?.trim() && !SEGMENT_PLACEHOLDERS.has(normalized)) return value.trim();
  return segmentFromActivity(activity) ?? "Сегмент не определён";
}

export function segmentFromActivity(activity: string | null | undefined) {
  const source = activity?.trim();
  if (!source) return null;
  const normalized = source.toLocaleLowerCase("ru-RU");
  const matches: Array<[RegExp, string]> = [
    [/прав[ао]|юридическ/, "Юридические услуги"],
    [/бухгалтер|аудит/, "Бухгалтерия и аудит"],
    [/реклам|маркетинг/, "Маркетинг и реклама"],
    [/программ|компьютер|информационн.*технолог/, "IT и разработка ПО"],
    [/консультир.*управлен|бизнес.*консалт/, "Бизнес-консалтинг"],
    [/строитель/, "Строительство"],
    [/перевоз|транспорт|логист/, "Транспорт и логистика"],
    [/образован|обучен/, "Образование"],
    [/медицин|здравоохран/, "Медицина"],
    [/недвижим/, "Недвижимость"],
  ];
  for (const [pattern, segment] of matches) if (pattern.test(normalized)) return segment;
  const compact = source
    .replace(/^деятельность\s+(?:в\s+области\s+|по\s+|связанная\s+с\s+)?/i, "")
    .replace(/,\s*прочая$/i, "")
    .trim();
  if (!compact) return null;
  return compact.charAt(0).toLocaleUpperCase("ru-RU") + compact.slice(1, 80);
}

export function publicCompanyFacts(
  data: Record<string, unknown> | null | undefined,
  identity?: { inn?: string | null },
): PublicCompanyFact[] {
  const source = data ?? {};
  const activity = firstText(source.primary_okved_name, source["checko.оквэд"], nested(source, "datanewton.main_block", "activity_kind_dsc"));
  const okved = firstText(source.primary_okved, nested(source, "datanewton.main_block", "activity_kind"));
  const region = firstText(source.region, nested(source, "datanewton.address_block", "region"));
  const leader = firstText(source.leader_name);
  const employees = firstNumber(source.employee_count, nested(source, "datanewton.workers_count_block", "2025"));
  const revenue = firstNumber(source.revenue);
  return [
    identity?.inn && { key: "inn" as const, label: "ИНН", value: identity.inn },
    activity && { key: "activity" as const, label: "Вид деятельности", value: activity },
    okved && { key: "okved" as const, label: "ОКВЭД", value: okved },
    region && { key: "region" as const, label: "Регион", value: region },
    leader && { key: "leader" as const, label: "Руководитель", value: leader },
    employees != null && { key: "employees" as const, label: "Сотрудники", value: Math.round(employees).toLocaleString("ru-RU") },
    revenue != null && { key: "revenue" as const, label: "Выручка", value: `${Math.round(revenue).toLocaleString("ru-RU")} ₽` },
  ].filter((fact): fact is PublicCompanyFact => Boolean(fact));
}

function nested(data: Record<string, unknown>, parent: string, key: string) {
  const value = data[parent];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}

function firstText(...values: unknown[]) {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}
