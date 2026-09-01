export const PAID_PERIOD_DURATION_DAYS = 30;
export const FIRST_PAID_PERIOD_DURATION_DAYS = 45;

// До этой даты первый оплаченный период составлял 30 дней. Бонусные 15 дней
// на прогрев появились только для новых первых оплат.
const FIRST_PAYMENT_45_DAY_POLICY_STARTED_AT = new Date("2026-08-29T00:00:00+03:00");

export function paidPeriodDurationDays(
  index: number,
  confirmedAt: Date,
  changeType = "ACTIVATE",
) {
  return index === 0
    && changeType === "ACTIVATE"
    && confirmedAt >= FIRST_PAYMENT_45_DAY_POLICY_STARTED_AT
    ? FIRST_PAID_PERIOD_DURATION_DAYS
    : PAID_PERIOD_DURATION_DAYS;
}

function addCalendarDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

export function expectedPaidPlanExpiry(
  payments: Array<{
    status: string;
    confirmedAt: Date | null;
    changeType?: string;
    activationMode?: string | null;
    entitlementEndsAt?: Date | null;
  }>,
) {
  const confirmed = payments
    .filter((payment) => payment.status === "CONFIRMED" && payment.confirmedAt)
    .sort((left, right) => left.confirmedAt!.getTime() - right.confirmedAt!.getTime());

  return confirmed.reduce<Date | null>((expiresAt, payment, index) => {
    const confirmedAt = payment.confirmedAt!;
    const durationDays = paidPeriodDurationDays(index, confirmedAt, payment.changeType);
    // Исторические операции до явного выбора режима сохраняют прежнюю
    // последовательную математику: каждый оплаченный период добавлялся к уже
    // выданному. Новые операции следуют выбранному моменту активации.
    if (payment.activationMode == null) {
      const legacyStartsAt = index > 0 && expiresAt && expiresAt > confirmedAt
        ? expiresAt
        : confirmedAt;
      return addCalendarDays(legacyStartsAt, durationDays);
    }
    const periodStartsAt = payment.activationMode === "NEXT_PERIOD"
      && payment.entitlementEndsAt
      && payment.entitlementEndsAt > confirmedAt
      ? payment.entitlementEndsAt
      : confirmedAt;
    return addCalendarDays(periodStartsAt, durationDays);
  }, null);
}
