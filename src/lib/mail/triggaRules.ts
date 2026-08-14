/**
 * Единый машиночитаемый источник правил доставляемости Trigga.
 *
 * Основание: docs/tz/cold-outreach-mailbox-model.md, версия 1.3,
 * §§1.4 и 5.6. Калькулятор, отправка и прогрев должны брать лимиты отсюда,
 * чтобы рекомендации в интерфейсе не расходились с фактическим поведением.
 */
export const TRIGGA_RULES = {
  /** Рекомендованный размер флота: 10 ящиков на 2 000 получателей. */
  recipientsPerMailboxMonthly: 200,
  workdaysPerMonth: 22,

  coldPerMailboxDailyMax: 30,
  coldPerDomainDailyMax: 120,
  mailboxesPerDomainMax: 4,

  warmup: {
    daysBeforeCampaign: 14,
    dailyStart: 2,
    dailyIncrement: 1,
    dailyMax: 10,
  },

  /** Холодные 30 + прогревочные 10. */
  totalPerMailboxDailyMax: 40,
} as const;

/** Целевой объём исходящего прогрева для конкретного дня ramp. */
export function triggaWarmupDailyTarget(day: number): number {
  const normalizedDay = Math.max(1, Math.floor(day));
  const { dailyStart, dailyIncrement, dailyMax } = TRIGGA_RULES.warmup;
  return Math.min(dailyMax, dailyStart + (normalizedDay - 1) * dailyIncrement);
}

/**
 * Минимум реально отправленных прогревочных писем перед допуском к кампании.
 * Не позволяет получить статус warm, просто прождав 14 календарных дней.
 */
export function triggaWarmupRequiredBeforeCampaign(): number {
  let total = 0;
  for (let day = 1; day <= TRIGGA_RULES.warmup.daysBeforeCampaign; day++) {
    total += triggaWarmupDailyTarget(day);
  }
  return total;
}
