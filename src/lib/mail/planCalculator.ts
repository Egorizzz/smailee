/**
 * План-калькулятор инфраструктуры (ТЗ §5.2).
 *
 * Вход: целевой объём получателей в месяц.
 * Выход: сколько нужно доменов и ящиков по правилам доставляемости
 * (ТЗ §1.4): ≤30 холодных/день на ЯЩИК, ≤120/день на ДОМЕН, ≤4 ящика на домен.
 *
 * Система считает — клиент исполняет руками (модель C). Чистая функция, 0 сети.
 */

import { toDnsLabel } from "../slug";
import { TRIGGA_RULES } from "./triggaRules";

export type InfraPlan = {
  monthlyVolume: number;
  firstTouchesPerDay: number;
  mailboxes: number; // всего ящиков
  domains: number; // всего доменов
  mailboxesPerDomain: number; // максимальное число ящиков на одном домене (≤4)
  mailboxDistribution: number[]; // точная раскладка по доменам, напр. [4, 3, 3]
  scheme: string; // «4 + 3 + 3 = 10 ящиков на 3 доменах»
  coldCapacityPerDay: number;
  contactsPerMailbox: number;
  domainNameHints: string[];
  notes: string[];
};

export function calcInfraPlan(monthlyVolume: number, companyName?: string): InfraPlan {
  const volume = Math.max(0, Math.floor(monthlyVolume));
  const firstTouchesPerDay = Math.ceil(volume / TRIGGA_RULES.workdaysPerMonth);

  // Это не математический минимум по 30 холодным письмам/день. Trigga задаёт
  // более консервативную сетку флота: 1 ящик на каждые 200 получателей в месяц.
  // Она оставляет место для цепочек, ротации и просадки отдельных ящиков.
  const mailboxes = Math.max(
    1,
    Math.ceil(volume / TRIGGA_RULES.recipientsPerMailboxMonthly)
  );
  const domains = Math.max(1, Math.ceil(mailboxes / TRIGGA_RULES.mailboxesPerDomainMax));
  const mailboxDistribution = distributeEvenly(mailboxes, domains);
  const mailboxesPerDomain = Math.max(...mailboxDistribution);
  const coldCapacityPerDay = mailboxes * TRIGGA_RULES.coldPerMailboxDailyMax;
  const contactsPerMailbox = Math.ceil(volume / mailboxes);

  const base = slugForDomain(companyName);
  const domainNameHints = buildDomainHints(base, domains);

  const notes = [
    `Сетка Trigga: 1 ящик на каждые ${TRIGGA_RULES.recipientsPerMailboxMonthly} получателей в месяц — это резерв под цепочки, ротацию и здоровье флота, а не математический минимум.`,
    `Жёсткие лимиты: ≤${TRIGGA_RULES.coldPerMailboxDailyMax} холодных писем/день с ящика, ≤${TRIGGA_RULES.coldPerDomainDailyMax}/день с домена, ≤${TRIGGA_RULES.mailboxesPerDomainMax} ящиков на домен.`,
    `Домены — нейтральные, с названием компании, без цифр и дефисов. Не основной домен компании (его репутацию бережём).`,
    `Каждый ящик прогревается минимум ${TRIGGA_RULES.warmup.daysBeforeCampaign} дней: 2 письма в день, затем +1/день до 10. После старта кампании прогрев не выключается.`,
    `Первичные касания распределены на ${TRIGGA_RULES.workdaysPerMonth} рабочих дня; фактическая холодная ёмкость флота — до ${coldCapacityPerDay} писем/день.`,
  ];

  return {
    monthlyVolume: volume,
    firstTouchesPerDay,
    mailboxes,
    domains,
    mailboxesPerDomain,
    mailboxDistribution,
    scheme: `${summarizeDistribution(mailboxDistribution)} = ${mailboxes} ${plural(mailboxes, "ящик", "ящика", "ящиков")}`,
    coldCapacityPerDay,
    contactsPerMailbox,
    domainNameHints,
    notes,
  };
}

function distributeEvenly(total: number, groups: number): number[] {
  const base = Math.floor(total / groups);
  const extra = total % groups;
  return Array.from({ length: groups }, (_, index) => base + (index < extra ? 1 : 0));
}

function summarizeDistribution(distribution: number[]): string {
  if (distribution.length <= 6) return distribution.join(" + ");

  const groups = new Map<number, number>();
  for (const count of distribution) groups.set(count, (groups.get(count) ?? 0) + 1);
  return [...groups.entries()]
    .map(([mailboxes, domains]) => `${domains} × ${mailboxes}`)
    .join(" + ");
}

function slugForDomain(companyName?: string): string {
  // toDnsLabel транслитерирует RU→lat и оставляет только [a-z0-9-] — домены
  // должны быть латиницей (без punycode-кириллицы), см. ТЗ §5.2.
  return toDnsLabel(companyName ?? "company", "company").replace(/-/g, "").slice(0, 16) || "company";
}

function buildDomainHints(base: string, domains: number): string[] {
  // нейтральные суффиксы без цифр/дефисов (ТЗ §5.2)
  const suffixes = [
    "tech", "hq", "team", "mail", "group", "pro", "hub", "works", "space",
    "online", "digital", "labs", "office", "connect", "studio", "service",
    "project", "business", "expert", "plus", "point", "center", "network",
    "global", "direct", "solutions", "partners", "systems", "agency", "cloud",
  ];
  const zones = [".ru", ".com", ".pro"];
  const hints: string[] = [];
  for (let i = 0; i < domains && i < suffixes.length; i++) {
    hints.push(`${base}${suffixes[i]}${zones[i % zones.length]}`);
  }
  return hints;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
