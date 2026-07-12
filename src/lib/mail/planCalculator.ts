/**
 * План-калькулятор инфраструктуры (ТЗ §5.2).
 *
 * Вход: целевой объём получателей в месяц.
 * Выход: сколько нужно доменов / персон / ящиков по правилам доставляемости
 * (ТЗ §1.4): ≤30 холодных/день на ЯЩИК, ≤120/день на ДОМЕН, ≤4 ящика на домен.
 *
 * Система считает — клиент исполняет руками (модель C). Чистая функция, 0 сети.
 */

import { toDnsLabel } from "../slug";

// Рабочих дней рассылки в месяце (консервативно, без выходных).
const WORKDAYS_PER_MONTH = 22;
const MAX_PER_MAILBOX_DAY = 30;
const MAX_PER_DOMAIN_DAY = 120;
const MAX_MAILBOXES_PER_DOMAIN = 4; // 4 × 30 = 120
const ALIASES_PER_PERSONA = 3; // 3 алиаса на персону (ТЗ §5.2)

export type InfraPlan = {
  monthlyVolume: number;
  perDayNeeded: number; // сколько писем/день нужно слать, чтобы закрыть объём
  mailboxes: number; // всего ящиков
  domains: number; // всего доменов
  mailboxesPerDomain: number; // ящиков на домен (≤4)
  personasPerDomain: number; // персон на домен (= ящиков на домен)
  aliasesPerPersona: number;
  scheme: string; // «3 домена × 4 персоны = 12 ящиков»
  domainNameHints: string[];
  aliasHints: string[];
  notes: string[];
};

export function calcInfraPlan(monthlyVolume: number, companyName?: string): InfraPlan {
  const volume = Math.max(0, Math.floor(monthlyVolume));
  const perDayNeeded = Math.ceil(volume / WORKDAYS_PER_MONTH);

  // ящиков нужно столько, чтобы покрыть дневной объём при ≤30/ящик
  const mailboxes = Math.max(1, Math.ceil(perDayNeeded / MAX_PER_MAILBOX_DAY));
  // доменов — чтобы покрыть и лимит 120/домен, и ≤4 ящика/домен
  const domainsByDaily = Math.ceil(perDayNeeded / MAX_PER_DOMAIN_DAY);
  const domainsByMailboxes = Math.ceil(mailboxes / MAX_MAILBOXES_PER_DOMAIN);
  const domains = Math.max(1, domainsByDaily, domainsByMailboxes);

  const mailboxesPerDomain = Math.min(
    MAX_MAILBOXES_PER_DOMAIN,
    Math.ceil(mailboxes / domains)
  );
  const totalMailboxes = domains * mailboxesPerDomain;

  const base = slugForDomain(companyName);
  const domainNameHints = buildDomainHints(base, domains);
  const aliasHints = buildAliasHints();

  const notes = [
    `Лимиты доставляемости: ≤${MAX_PER_MAILBOX_DAY} писем/день с ящика, ≤${MAX_PER_DOMAIN_DAY}/день с домена, ≤${MAX_MAILBOXES_PER_DOMAIN} ящика на домен.`,
    `Домены — нейтральные, с названием компании, без цифр и дефисов. Не основной домен компании (его репутацию бережём).`,
    `Каждый ящик перед рассылкой прогревается 14 дней (прогрев идёт параллельно, в лимит 30 не входит).`,
    `Расчёт на ${WORKDAYS_PER_MONTH} рабочих дней/мес; фактический темп можно растянуть.`,
  ];

  return {
    monthlyVolume: volume,
    perDayNeeded,
    mailboxes: totalMailboxes,
    domains,
    mailboxesPerDomain,
    personasPerDomain: mailboxesPerDomain,
    aliasesPerPersona: ALIASES_PER_PERSONA,
    scheme: `${domains} ${plural(domains, "домен", "домена", "доменов")} × ${mailboxesPerDomain} ${plural(
      mailboxesPerDomain,
      "персона",
      "персоны",
      "персон"
    )} = ${totalMailboxes} ${plural(totalMailboxes, "ящик", "ящика", "ящиков")}`,
    domainNameHints,
    aliasHints,
    notes,
  };
}

function slugForDomain(companyName?: string): string {
  // toDnsLabel транслитерирует RU→lat и оставляет только [a-z0-9-] — домены
  // должны быть латиницей (без punycode-кириллицы), см. ТЗ §5.2.
  return toDnsLabel(companyName ?? "company", "company").replace(/-/g, "").slice(0, 16) || "company";
}

function buildDomainHints(base: string, domains: number): string[] {
  // нейтральные суффиксы без цифр/дефисов (ТЗ §5.2)
  const suffixes = ["tech", "hq", "team", "mail", "group", "pro", "hub", "works"];
  const zones = [".ru", ".com", ".pro"];
  const hints: string[] = [];
  for (let i = 0; i < domains && i < suffixes.length; i++) {
    hints.push(`${base}${suffixes[i]}${zones[i % zones.length]}`);
  }
  return hints;
}

function buildAliasHints(): string[] {
  // 3 алиаса на персону «Иван Иванов» (ТЗ §5.2)
  return ["i.ivanov", "ivanov.i", "ivan.ivanov"];
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
