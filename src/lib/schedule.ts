/**
 * Окно отправки (§5.3, §5.6): рабочие дни/часы, в которые уходят и боевые
 * письма, и прогрев. Вне окна не шлём ничего.
 *
 * До этого окна не было вообще — прогрев мог уйти в любое время суток. Счётчик
 * дня прогрева сбрасывается по календарной дате через `Date.toDateString()`
 * (см. warmupEngine.ts), а она берётся в ЛОКАЛЬНОЙ таймзоне процесса. Прод
 * (Docker-контейнер на Amvera, без явного TZ) живёт в UTC, то есть сброс
 * происходит в UTC-полночь — 3 часа ночи по Москве. Воркер тикает раз в
 * 5 секунд, и первый же тик после сброса высылал всю дневную квоту одним
 * залпом ровно в этот момент. Отсюда письма в 3 ночи.
 *
 * Таймзона окна по умолчанию — Europe/Moscow: аудитория и почтовые провайдеры
 * (§1.5, Яндекс 360) — российские, независимо от того, где физически стоит
 * сервер.
 */

export type SendWindow = {
  enabled: boolean;
  timeZone: string;
  /** Час начала окна, 0-23, включительно. */
  startHour: number;
  /** Час конца окна, 0-23, окно полуоткрытое [startHour, endHour). */
  endHour: number;
  /** ISO-нумерация: 1=Пн … 7=Вс. */
  weekdays: readonly number[];
};

const WEEKDAY_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function zonedParts(date: Date, timeZone: string): { isoWeekday: number; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // hour12:false на некоторых движках ICU отдаёт "24" вместо "00" для полуночи
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { isoWeekday: WEEKDAY_ISO[get("weekday")] ?? 0, minutesOfDay: hour * 60 + minute };
}

export function isWithinSendWindow(now: Date, w: SendWindow): boolean {
  if (!w.enabled) return true;
  const { isoWeekday, minutesOfDay } = zonedParts(now, w.timeZone);
  if (!w.weekdays.includes(isoWeekday)) return false;
  return minutesOfDay >= w.startHour * 60 && minutesOfDay < w.endHour * 60;
}

/**
 * Доля рабочего окна, прошедшая «сегодня»: 0 до открытия, 1 после закрытия,
 * линейно между ними. Используется, чтобы размазать дневную квоту прогрева по
 * окну, а не выслать её одним залпом сразу в момент открытия (см. warmupEngine).
 * Вне зависимости от `enabled` — прогресс считается по факту времени, решение
 * слать или нет принимает isWithinSendWindow.
 */
export function sendWindowProgress(now: Date, w: SendWindow): number {
  const { minutesOfDay } = zonedParts(now, w.timeZone);
  const startMin = w.startHour * 60;
  const endMin = w.endHour * 60;
  if (minutesOfDay <= startMin) return 0;
  if (minutesOfDay >= endMin) return 1;
  return (minutesOfDay - startMin) / (endMin - startMin);
}
