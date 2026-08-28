export type ProspectingRoleOption = {
  value: string;
  group: string;
  departments: string[];
  aliases: string[];
};

export const PROSPECTING_ROLE_OPTIONS: ProspectingRoleOption[] = [
  { value: "Собственник / основатель", group: "Руководство", departments: ["executive"], aliases: ["собственник", "владелец", "основатель", "учредитель", "owner", "founder"] },
  { value: "Генеральный директор", group: "Руководство", departments: ["executive"], aliases: ["генеральный директор", "гендиректор", "ceo", "chief executive"] },
  { value: "Исполнительный директор", group: "Руководство", departments: ["executive", "operations"], aliases: ["исполнительный директор", "управляющий директор", "coo"] },
  { value: "Коммерческий директор", group: "Продажи и развитие", departments: ["executive", "sales"], aliases: ["коммерческий директор", "cco", "chief commercial"] },
  { value: "Директор по продажам", group: "Продажи и развитие", departments: ["sales"], aliases: ["директор по продажам", "руководитель продаж", "head of sales", "sales director"] },
  { value: "Руководитель отдела продаж", group: "Продажи и развитие", departments: ["sales"], aliases: ["роп", "начальник отдела продаж", "руководитель отдела продаж", "sales lead"] },
  { value: "Директор по развитию", group: "Продажи и развитие", departments: ["executive", "management", "sales"], aliases: ["директор по развитию", "business development director", "head of business development"] },
  { value: "Директор по маркетингу", group: "Маркетинг", departments: ["marketing"], aliases: ["директор по маркетингу", "cmo", "marketing director", "chief marketing officer"] },
  { value: "Руководитель маркетинга", group: "Маркетинг", departments: ["marketing"], aliases: ["руководитель маркетинга", "head of marketing", "marketing lead"] },
  { value: "Директор по персоналу", group: "Персонал", departments: ["hr"], aliases: ["директор по персоналу", "директор по кадрам", "hrd", "chief people officer"] },
  { value: "Руководитель HR", group: "Персонал", departments: ["hr"], aliases: ["руководитель hr", "руководитель персонала", "head of hr", "hr lead"] },
  { value: "Финансовый директор", group: "Финансы", departments: ["finance", "executive"], aliases: ["финансовый директор", "cfo", "finance director"] },
  { value: "Главный бухгалтер", group: "Финансы", departments: ["finance"], aliases: ["главный бухгалтер", "chief accountant"] },
  { value: "ИТ-директор", group: "ИТ и продукт", departments: ["it", "executive"], aliases: ["ит директор", "it директор", "cio", "cto", "технический директор"] },
  { value: "Руководитель ИТ", group: "ИТ и продукт", departments: ["it"], aliases: ["руководитель ит", "head of it", "it manager"] },
  { value: "Директор по продукту", group: "ИТ и продукт", departments: ["product", "executive"], aliases: ["директор по продукту", "cpo", "chief product officer"] },
  { value: "Руководитель продукта", group: "ИТ и продукт", departments: ["product"], aliases: ["руководитель продукта", "head of product", "product lead"] },
  { value: "Операционный директор", group: "Операции", departments: ["operations", "executive"], aliases: ["операционный директор", "coo", "operations director"] },
  { value: "Руководитель операций", group: "Операции", departments: ["operations"], aliases: ["руководитель операций", "head of operations", "operations manager"] },
  { value: "Директор по закупкам", group: "Закупки", departments: ["procurement"], aliases: ["директор по закупкам", "руководитель закупок", "procurement director"] },
  { value: "Руководитель снабжения", group: "Закупки", departments: ["procurement", "operations"], aliases: ["руководитель снабжения", "начальник снабжения", "supply manager"] },
  { value: "Юридический директор", group: "Право", departments: ["legal", "executive"], aliases: ["юридический директор", "директор по правовым вопросам", "general counsel", "chief legal officer"] },
  { value: "Руководитель юридического отдела", group: "Право", departments: ["legal"], aliases: ["руководитель юридического отдела", "главный юрист", "head of legal"] },
  { value: "Директор по клиентскому сервису", group: "Клиентский сервис", departments: ["support", "communication"], aliases: ["директор по клиентскому сервису", "customer service director", "customer success director"] },
  { value: "Руководитель клиентского сервиса", group: "Клиентский сервис", departments: ["support", "communication"], aliases: ["руководитель клиентского сервиса", "head of customer success", "support lead"] },
  { value: "Директор по исследованиям", group: "Исследования", departments: ["research"], aliases: ["директор по исследованиям", "r&d director", "research director"] },
  { value: "Руководитель консалтинга", group: "Консалтинг", departments: ["consulting"], aliases: ["руководитель консалтинга", "consulting director", "head of consulting"] },
];

export const LEGAL_FORM_OPTIONS = [
  { value: "ООО", label: "ООО", description: "Общество с ограниченной ответственностью", providerCodes: ["12300"] },
  { value: "ИП", label: "ИП", description: "Индивидуальный предприниматель", providerCodes: ["50102"] },
  { value: "АО", label: "АО", description: "Акционерные общества всех типов", providerCodes: ["12200", "12247", "12267", "47", "67"] },
  { value: "ПАО", label: "ПАО", description: "Публичное акционерное общество", providerCodes: ["12247"] },
  { value: "НАО", label: "НАО", description: "Непубличное акционерное общество", providerCodes: ["12267"] },
  { value: "АНО", label: "АНО", description: "Автономная некоммерческая организация", providerCodes: ["71400", "97"] },
  { value: "ФГУП", label: "ФГУП", description: "Федеральное государственное унитарное предприятие", providerCodes: ["65241"] },
  { value: "МУП", label: "МУП", description: "Муниципальное унитарное предприятие", providerCodes: ["65243"] },
  { value: "ПК", label: "Кооператив", description: "Производственный или потребительский кооператив", providerCodes: ["14000", "14100", "14200", "20100", "52", "85"] },
  { value: "КФХ", label: "КФХ", description: "Крестьянское (фермерское) хозяйство", providerCodes: ["15300", "50101", "53"] },
] as const;

export function dataNewtonOpfCodes(values: string[]) {
  return [...new Set(values.flatMap((value) => LEGAL_FORM_OPTIONS.find((option) => option.value === value)?.providerCodes ?? []))];
}

function normalized(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function matchProspectingRole(value: string) {
  const needle = normalized(value);
  if (!needle) return undefined;
  return PROSPECTING_ROLE_OPTIONS.find((option) =>
    normalized(option.value) === needle || option.aliases.some((alias) => {
      const candidate = normalized(alias);
      return candidate === needle || needle.includes(candidate) || candidate.includes(needle);
    })
  );
}

export function normalizeProspectingRoles(values: string[]) {
  return [...new Set(values.map((value) => matchProspectingRole(value)?.value ?? value.trim()).filter(Boolean))].slice(0, 12);
}

export function hunterDepartmentsForRoles(values: string[]) {
  return [...new Set(values.flatMap((value) => matchProspectingRole(value)?.departments ?? []))];
}

export function roleMatchesPreference(role: string | undefined, desiredRoles: string[]) {
  if (!role || !desiredRoles.length) return false;
  const normalizedRole = normalized(role);
  return desiredRoles.some((desired) => {
    const option = matchProspectingRole(desired);
    return normalizedRole.includes(normalized(desired)) || Boolean(option?.aliases.some((alias) => normalizedRole.includes(normalized(alias))));
  });
}
