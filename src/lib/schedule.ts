/**
 * Окно отправки (§5.3, §5.6): дни/часы, в которые разрешён конкретный поток.
 * Холодные кампании используют Пн–Пт, прогрев — все семь дней; оба потока
 * ограничены дневными часами. Вне переданного окна не шлём ничего.
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

function zonedParts(date: Date, timeZone: string): { isoWeekday: number; secondsOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // hour12:false на некоторых движках ICU отдаёт "24" вместо "00" для полуночи
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  return {
    isoWeekday: WEEKDAY_ISO[get("weekday")] ?? 0,
    secondsOfDay: hour * 3600 + minute * 60 + second,
  };
}

/** Стабильный ключ локального календарного дня в таймзоне окна. */
export function sendWindowDayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isWithinSendWindow(now: Date, w: SendWindow): boolean {
  if (!w.enabled) return true;
  const { isoWeekday, secondsOfDay } = zonedParts(now, w.timeZone);
  if (!w.weekdays.includes(isoWeekday)) return false;
  return secondsOfDay >= w.startHour * 3600 && secondsOfDay < w.endHour * 3600;
}

/**
 * Возвращает ближайший аккуратный 15-минутный слот, попадающий в окно отправки.
 * Используется для дат, которые показываем пользователю заранее: интерфейс и
 * воркер должны обещать одно и то же время.
 */
export function nextSendWindowTime(target: Date, w: SendWindow): Date {
  if (!w.enabled) return new Date(target);
  const stepMs = 15 * 60_000;
  let candidate = new Date(Math.ceil(target.getTime() / stepMs) * stepMs);
  const maxSteps = 8 * 24 * 4;
  for (let step = 0; step <= maxSteps; step += 1) {
    if (isWithinSendWindow(candidate, w)) return candidate;
    candidate = new Date(candidate.getTime() + stepMs);
  }
  throw new Error("Не удалось найти ближайшее окно отправки");
}

/**
 * Доля рабочего окна, прошедшая «сегодня»: 0 до открытия, 1 после закрытия,
 * линейно между ними. Используется, чтобы размазать дневную квоту прогрева по
 * окну, а не выслать её одним залпом сразу в момент открытия (см. warmupEngine).
 *
 * `!w.enabled` → 1 (квота открыта полностью, размазывать нечем — окна нет).
 * Раньше это не проверялось: функция сама заявляла «вне зависимости от
 * enabled», и при отключённом окне квота всё равно урезалась пропорцией
 * реального часа МСК. Из-за этого интеграционные тесты (SEND_WINDOW_ENABLED=
 * false в scripts/integration/run.ts, чтобы не зависеть от времени прогона)
 * были нестабильны и падали не по будням/утрам — обнаружено 2026-08-01,
 * в субботу, тест на 5 раундов прогрева получил только ~1 отправку вместо 5.
 * Тот же баг живёт и в проде: явное отключение окна через переменную не
 * отключало бы урезание квоты, только гейт по дням/часам.
 */
export function sendWindowProgress(now: Date, w: SendWindow): number {
  if (!w.enabled) return 1;
  const { secondsOfDay } = zonedParts(now, w.timeZone);
  const startSeconds = w.startHour * 3600;
  const endSeconds = w.endHour * 3600;
  if (secondsOfDay <= startSeconds) return 0;
  if (secondsOfDay >= endSeconds) return 1;
  return (secondsOfDay - startSeconds) / (endSeconds - startSeconds);
}
